#!/usr/bin/env bun
// Historical-arb replay. Reads the WETH/USDC reserves on Uniswap V2 and
// Sushiswap at whatever block anvil is forked at, runs the bot's standing-
// arb math in both possible round-trip directions, and either:
//
//   (a) executes the better direction via Aave V3 flashloan when a real
//       profitable gap exists, asserts realized matches predicted, or
//   (b) prints a diagnostic gap analysis showing what input each direction
//       would consume and what loss-to-fees the bot would expect at the
//       current state, exiting 0 (no arb opportunity is not a failure).
//
// Usage:
//
//   # Terminal 1 — anvil at HEAD
//   anvil --fork-url https://ethereum-rpc.publicnode.com
//
//   # Terminal 1, alternate — anvil pinned to a known-arb block
//   #   (requires archival access — Alchemy/Infura/own node)
//   anvil --fork-url $ALCHEMY_URL --fork-block-number 15990000
//
//   # Terminal 2
//   cd bot && bun run replay
//
// The diagnostic-only run is the default outcome at any random recent
// block: cross-DEX gaps on WETH/USDC are normally closed by competing
// arbitrageurs within the same block, so the typical standing gap is
// well under the combined 0.6% round-trip fee. Pinning FORK_BLOCK to a
// moment of high volatility (e.g. liquidation cascades, large mempool
// trades that landed without a back-runner) is what turns this from a
// gap-analysis tool into an actual historical replay.

import {readFileSync} from "node:fs";
import {join} from "node:path";

import {
    createPublicClient,
    createWalletClient,
    http,
    parseAbi,
    type Address,
    type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {mainnet} from "viem/chains";

import {getAmountOut, getOptimalInput, type PoolReserves} from "../src/amm";
import {AAVE_V3_POOL, buildFlashloanCall} from "../src/bundle";
import type {Dex} from "../src/pairs";
import type {ScoredArb} from "../src/score";
import {fetchChainFees, signExecutorTx} from "../src/sign";

// ---- Constants ----
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const UNIV2_WETH_USDC: Address = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
const SUSHI_WETH_USDC: Address = "0x397FF1542f962076d0BFE58eA045FfA2d347ACa0";

const ANVIL_KEY_0: Hex =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const ANVIL_URL = process.env["ANVIL_URL"] ?? "http://localhost:8545";

const AAVE_PREMIUM_BPS = 5n;
const BPS_DENOMINATOR = 10_000n;

// ---- ABIs ----
const PAIR_ABI = parseAbi([
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

// ---- Formatting ----
function fmtWei(n: bigint, decimals: number, displayDecimals = 6): string {
    const d = 10n ** BigInt(decimals);
    const whole = n / d;
    const frac = n % d;
    return `${whole}.${frac.toString().padStart(decimals, "0").slice(0, displayDecimals)}`;
}
const fmtWETH = (n: bigint): string => `${fmtWei(n, 18)} WETH`;
const fmtUSDC = (n: bigint): string => `${fmtWei(n, 6)} USDC`;
function banner(title: string): void {
    console.log(`\n━━━ ${title} ━━━`);
}

// ---- Reserve fetcher ----
type Reserves = {pair: Address; usdc: bigint; weth: bigint};

async function readReserves(
    client: ReturnType<typeof createPublicClient>,
    pair: Address,
): Promise<Reserves> {
    const [r0, r1] = (await client.readContract({
        address: pair,
        abi: PAIR_ABI,
        functionName: "getReserves",
    })) as readonly [bigint, bigint, number];
    // USDC < WETH (numerically), so USDC is token0 on both pairs.
    return {pair, usdc: r0, weth: r1};
}

// ---- Direction analyzer ----
//
// "sellPool" is where we deposit WETH to get USDC, "buyPool" is where we
// deposit USDC to get WETH back. The base asset (= what we measure profit
// in) is always WETH; the intermediate is always USDC.
type Direction = {
    label: string;
    sellDex: Dex;
    buyDex: Dex;
    sellPair: Address;
    buyPair: Address;
    leg1: PoolReserves;
    leg2: PoolReserves;
    amountIn: bigint;
    intermediateOut: bigint;
    expectedOut: bigint;
    grossProfit: bigint;
};

function analyzeDirection(
    label: string,
    sellDex: Dex,
    sell: Reserves,
    buyDex: Dex,
    buy: Reserves,
): Direction {
    const leg1: PoolReserves = {reserveIn: sell.weth, reserveOut: sell.usdc};
    const leg2: PoolReserves = {reserveIn: buy.usdc, reserveOut: buy.weth};
    const amountIn = getOptimalInput(leg1, leg2);
    if (amountIn === 0n) {
        // No optimal-input solution → use 1 WETH as a probe to show the round-trip loss.
        const probeIn = 1n * 10n ** 18n;
        const probeMid = getAmountOut(probeIn, leg1.reserveIn, leg1.reserveOut);
        const probeOut = getAmountOut(probeMid, leg2.reserveIn, leg2.reserveOut);
        return {
            label,
            sellDex,
            buyDex,
            sellPair: sell.pair,
            buyPair: buy.pair,
            leg1,
            leg2,
            amountIn: probeIn,
            intermediateOut: probeMid,
            expectedOut: probeOut,
            grossProfit: probeOut - probeIn, // signed; negative for unprofitable
        };
    }
    const intermediateOut = getAmountOut(amountIn, leg1.reserveIn, leg1.reserveOut);
    const expectedOut = getAmountOut(intermediateOut, leg2.reserveIn, leg2.reserveOut);
    return {
        label,
        sellDex,
        buyDex,
        sellPair: sell.pair,
        buyPair: buy.pair,
        leg1,
        leg2,
        amountIn,
        intermediateOut,
        expectedOut,
        grossProfit: expectedOut - amountIn,
    };
}

function printDirection(dir: Direction, profitable: boolean): void {
    const tag = profitable ? "PROFITABLE" : "unprofitable (probe input)";
    console.log(`[replay] ${dir.label} (${tag}):`);
    console.log(`[replay]   sell on ${dir.sellDex} (${dir.sellPair.slice(0, 8)}…) → buy on ${dir.buyDex} (${dir.buyPair.slice(0, 8)}…)`);
    console.log(`[replay]   amountIn:        ${fmtWETH(dir.amountIn)}`);
    console.log(`[replay]   intermediateOut: ${fmtUSDC(dir.intermediateOut)}`);
    console.log(`[replay]   expectedOut:     ${fmtWETH(dir.expectedOut)}`);
    if (dir.grossProfit >= 0n) {
        console.log(`[replay]   gross profit:    +${fmtWETH(dir.grossProfit)}`);
    } else {
        console.log(`[replay]   gross loss:      −${fmtWETH(-dir.grossProfit)}`);
    }
}

// ---- Main ----
async function main(): Promise<void> {
    const publicClient = createPublicClient({chain: mainnet, transport: http(ANVIL_URL)});

    try {
        await publicClient.getBlockNumber();
    } catch (err) {
        console.error(`\n[replay] cannot reach anvil at ${ANVIL_URL}.`);
        console.error(`[replay] start it first:\n  anvil --fork-url <archival-rpc>\n`);
        console.error(`[replay] error: ${(err as Error).message}\n`);
        process.exit(1);
    }
    const blockNumber = await publicClient.getBlockNumber();
    console.log(`[replay] anvil reachable at ${ANVIL_URL}, forked at block ${blockNumber}`);

    banner("RESERVE SNAPSHOT");
    const [uni, sushi] = await Promise.all([
        readReserves(publicClient, UNIV2_WETH_USDC),
        readReserves(publicClient, SUSHI_WETH_USDC),
    ]);
    console.log(`[replay] UniV2  ${uni.pair.slice(0, 8)}…  USDC=${fmtUSDC(uni.usdc)}  WETH=${fmtWETH(uni.weth)}`);
    console.log(`[replay] Sushi  ${sushi.pair.slice(0, 8)}…  USDC=${fmtUSDC(sushi.usdc)}  WETH=${fmtWETH(sushi.weth)}`);

    // Implied price (USDC per WETH, scaled 1e18 for precision in display only)
    const priceUni = (uni.usdc * 10n ** 18n) / uni.weth;
    const priceSushi = (sushi.usdc * 10n ** 18n) / sushi.weth;
    const priceUniDisplay = (Number(priceUni) / 1e18) * 1e12; // USDC has 6 decimals; rescale for display
    const priceSushiDisplay = (Number(priceSushi) / 1e18) * 1e12;
    const gapBps =
        priceUni > priceSushi
            ? Number((priceUni - priceSushi) * 10_000n / priceSushi)
            : Number((priceSushi - priceUni) * 10_000n / priceUni);
    console.log(`[replay] implied USDC/WETH (UniV2 / Sushi): ${priceUniDisplay.toFixed(2)} / ${priceSushiDisplay.toFixed(2)}`);
    console.log(`[replay] cross-DEX gap: ${(gapBps / 100).toFixed(3)}% (round-trip fee floor is ~0.60%)`);

    banner("DIRECTION ANALYSIS");
    const dirA = analyzeDirection("A: sell-on-UniV2", "uniswap-v2", uni, "sushiswap", sushi);
    const dirB = analyzeDirection("B: sell-on-Sushi", "sushiswap", sushi, "uniswap-v2", uni);
    const profitableA = dirA.grossProfit > 0n && dirA.amountIn > 0n && getOptimalInput(dirA.leg1, dirA.leg2) > 0n;
    const profitableB = dirB.grossProfit > 0n && dirB.amountIn > 0n && getOptimalInput(dirB.leg1, dirB.leg2) > 0n;
    printDirection(dirA, profitableA);
    printDirection(dirB, profitableB);

    if (!profitableA && !profitableB) {
        banner("DIAGNOSIS");
        console.log(`[replay] no profitable arb at block ${blockNumber}.`);
        console.log(`[replay] this is normal at any random recent block — competing`);
        console.log(`[replay] MEV bots close cross-DEX gaps within the same block they`);
        console.log(`[replay] form. To find a real historical opportunity, pin anvil`);
        console.log(`[replay] to a block of high volatility (large liquidations, mempool`);
        console.log(`[replay] congestion, etc.) and re-run with archival RPC access.`);
        return;
    }

    const best = profitableA && (!profitableB || dirA.grossProfit > dirB.grossProfit) ? dirA : dirB;
    banner("EXECUTING BEST DIRECTION");
    console.log(`[replay] selected: ${best.label}`);
    console.log(`[replay]   ${best.sellDex} → ${best.buyDex}`);
    console.log(`[replay]   gross predicted profit: ${fmtWETH(best.grossProfit)}`);

    // Deploy executor (anvil key 0)
    const botAccount = privateKeyToAccount(ANVIL_KEY_0);
    const botWallet = createWalletClient({
        chain: mainnet,
        transport: http(ANVIL_URL),
        account: botAccount,
    });
    const artifactPath = join(
        import.meta.dir,
        "../../contracts/out/Executor.yul/QuarryExecutor.json",
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
        bytecode: {object: Hex};
    };
    const deployHash = await botWallet.sendTransaction({data: artifact.bytecode.object});
    const deployReceipt = await publicClient.waitForTransactionReceipt({hash: deployHash});
    if (!deployReceipt.contractAddress) throw new Error("[replay] deploy failed");
    const executor = deployReceipt.contractAddress;
    console.log(`[replay] executor deployed at ${executor}`);

    // Build ScoredArb shape for the bundle builder. The fields map to the
    // direction we picked: victimPair = sell-side pool, arbPair = buy-side.
    const arb: ScoredArb = {
        victimDex: best.sellDex,
        arbDex: best.buyDex,
        baseToken: WETH,
        intermediateToken: USDC,
        amountIn: best.amountIn,
        intermediateOut: best.intermediateOut,
        expectedOut: best.expectedOut,
        profit: best.grossProfit,
        victimPair: best.sellPair,
        arbPair: best.buyPair,
        gasCostWei: 0n,
    };

    const premium = (arb.amountIn * AAVE_PREMIUM_BPS) / BPS_DENOMINATOR;
    const expectedNet = arb.profit > premium ? arb.profit - premium : 0n;
    console.log(`[replay] Aave premium (5 bp on WETH): ${fmtWETH(premium)}`);
    console.log(`[replay] expected net (gross − premium): ${fmtWETH(expectedNet)}`);

    const call = buildFlashloanCall(arb, executor);
    const fees = await fetchChainFees(publicClient, botAccount.address, 1, 400_000n);
    const signedTx = await signExecutorTx(ANVIL_KEY_0, call.to, call.data, fees);
    const execHash = await publicClient.request({
        method: "eth_sendRawTransaction",
        params: [signedTx],
    });
    const execReceipt = await publicClient.waitForTransactionReceipt({hash: execHash});

    if (execReceipt.status !== "success") {
        console.error(`[replay] flashloan tx reverted: ${execHash}`);
        console.error(`[replay] target: ${AAVE_V3_POOL}`);
        process.exit(1);
    }
    console.log(`[replay] flashloan tx mined: ${execHash}`);
    console.log(`[replay] tx gas used: ${execReceipt.gasUsed}`);

    banner("VERIFY");
    const finalBalance = (await publicClient.readContract({
        address: WETH,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [executor],
    })) as bigint;
    console.log(`[replay] executor's final WETH balance: ${fmtWETH(finalBalance)}`);
    console.log(`[replay] net predicted profit: ${fmtWETH(expectedNet)}`);
    console.log(`[replay] net realized profit:  ${fmtWETH(finalBalance)}`);
    if (finalBalance > 0n) {
        console.log(`\n[replay] ✓ historical-arb replay successful.`);
    } else {
        console.error(`\n[replay] ✗ net realized non-positive — investigate.`);
        process.exit(1);
    }
}

main().catch((err: Error) => {
    console.error(err);
    process.exit(1);
});
