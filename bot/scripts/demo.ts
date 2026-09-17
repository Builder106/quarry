#!/usr/bin/env bun
// End-to-end Quarry demo. Spins through the full back-run pipeline against a
// forked-mainnet anvil instance: deploys the V3 Yul executor, simulates a
// large victim USDC→WETH swap on Uniswap V2, scores the resulting back-run
// opportunity, borrows the back-run input from Aave V3 via flashLoanSimple,
// runs the executor's two-hop arb, repays Aave + premium, and asserts that
// the realized profit (net of premium) matches the scoring prediction.
//
// Prereq: an anvil mainnet fork at http://localhost:8545. From the repo root:
//
//   anvil --fork-url https://ethereum-rpc.publicnode.com
//
// Then in another terminal, from `bot/`:
//
//   bun run demo
//
// Override the RPC with ANVIL_URL; default is http://localhost:8545.

import {readFileSync} from "node:fs";
import {join} from "node:path";

import {
    createPublicClient,
    createTestClient,
    createWalletClient,
    encodeAbiParameters,
    http,
    keccak256,
    pad,
    parseAbi,
    publicActions,
    walletActions,
    toHex,
    type Address,
    type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {mainnet} from "viem/chains";

import {AAVE_V3_POOL, buildFlashloanCall} from "../src/bundle";
import type {DecodedSwap} from "../src/decode";
import {scoreOpportunity} from "../src/score";
import {fetchChainFees, signExecutorTx} from "../src/sign";

// Aave V3 mainnet flashLoanSimple premium = 5 basis points.
const AAVE_PREMIUM_BPS = 5n;
const BPS_DENOMINATOR = 10_000n;

// ---- Mainnet canonical addresses ----
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const UNIV2_ROUTER: Address = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const UNIV2_WETH_USDC: Address = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
const SUSHI_WETH_USDC: Address = "0x397FF1542f962076d0BFE58eA045FfA2d347ACa0";

// Circle's USDC reserve — typically holds 100M+ USDC at any recent block.
// If this address ever drains, fall back to one of the Binance hot wallets
// (0x28C6c06298d514Db089934071355E5743bf21d60, 0xF977…aceC).
const USDC_WHALE: Address = "0x55FE002aefF02F77364de339a1292923A15844B8";

// Synthetic victim — needs gas + USDC to execute its swap. Address is
// arbitrary; we just need somewhere to receive the WETH output.
const VICTIM: Address = "0x000000000000000000000000000000000000bEEF";
const VICTIM_USDC_IN = 1_000_000n * 10n ** 6n; // 1M USDC, ~20% of typical UniV2 USDC reserves

// Anvil key 0 — published test key, never use for real funds.
const ANVIL_KEY_0: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const ANVIL_URL = process.env["ANVIL_URL"] ?? "http://localhost:8545";

// ---- ABIs ----
const ERC20_ABI = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
]);
const ROUTER_ABI = parseAbi([
    "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
]);
const PAIR_ABI = parseAbi([
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);

// ---- Pretty-printing ----
function fmtWei(n: bigint, decimals: number): string {
    const d = 10n ** BigInt(decimals);
    const whole = n / d;
    const frac = n % d;
    return `${whole}.${frac.toString().padStart(decimals, "0").slice(0, 6)}`;
}
function fmtWETH(n: bigint): string {
    return `${fmtWei(n, 18)} WETH`;
}
function fmtUSDC(n: bigint): string {
    return `${fmtWei(n, 6)} USDC`;
}
function shortAddr(a: Address): string {
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function symbolOf(token: Address): string {
    if (token.toLowerCase() === WETH.toLowerCase()) return "WETH";
    if (token.toLowerCase() === USDC.toLowerCase()) return "USDC";
    return shortAddr(token);
}
function fmtAmount(token: Address, amount: bigint): string {
    const sym = symbolOf(token);
    if (sym === "WETH") return fmtWETH(amount);
    if (sym === "USDC") return fmtUSDC(amount);
    return `${amount} ${sym}`;
}
function banner(title: string): void {
    console.log(`\n━━━ ${title} ━━━`);
}

// ---- Main ----
async function main(): Promise<void> {
    const publicClient = createPublicClient({chain: mainnet, transport: http(ANVIL_URL)});

    // Probe the RPC up front — give a clear error if anvil isn't running.
    try {
        await publicClient.getBlockNumber();
    } catch (err) {
        console.error(`\n[demo] cannot reach anvil at ${ANVIL_URL}.`);
        console.error(`[demo] start it first:\n`);
        console.error(`  anvil --fork-url https://ethereum-rpc.publicnode.com\n`);
        console.error(`[demo] underlying error: ${(err as Error).message}\n`);
        process.exit(1);
    }

    const testClient = createTestClient({
        chain: mainnet,
        transport: http(ANVIL_URL),
        mode: "anvil",
    })
        .extend(publicActions)
        .extend(walletActions);

    const botAccount = privateKeyToAccount(ANVIL_KEY_0);
    const botWallet = createWalletClient({
        chain: mainnet,
        transport: http(ANVIL_URL),
        account: botAccount,
    });

    console.log(`[demo] anvil reachable at ${ANVIL_URL}`);
    console.log(`[demo] bot account: ${shortAddr(botAccount.address)}`);

    // ---- 1. Deploy executor ----
    banner("DEPLOY");
    const artifactPath = join(
        import.meta.dir,
        "../../contracts/out/Executor.yul/QuarryExecutor.json",
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
        bytecode: {object: Hex};
    };
    const bytecode = artifact.bytecode.object;
    const deployHash = await botWallet.sendTransaction({data: bytecode});
    const deployReceipt = await publicClient.waitForTransactionReceipt({hash: deployHash});
    if (!deployReceipt.contractAddress) {
        throw new Error("[demo] executor deploy failed");
    }
    const executor = deployReceipt.contractAddress;
    console.log(`[demo] executor deployed at ${executor}`);
    console.log(`[demo] deploy gas used: ${deployReceipt.gasUsed}`);

    // ---- 2. Score the back-run ----
    banner("SCORE (pre-victim)");
    await snapshotPools(publicClient);
    const victimSwap: DecodedSwap = {
        kind: "exactInForTokens",
        amountIn: VICTIM_USDC_IN,
        amountOutMin: 0n,
        path: [USDC, WETH],
        to: VICTIM,
        deadline: 10n ** 18n,
    };
    console.log(
        `[demo] hypothetical victim: ${shortAddr(VICTIM)} sells ${fmtUSDC(VICTIM_USDC_IN)} for WETH on UniV2`,
    );
    const arb = await scoreOpportunity(publicClient, victimSwap, "uniswap-v2");
    if (!arb) {
        console.error(`\n[demo] no profitable back-run found at current fork state.`);
        console.error(`[demo] try increasing VICTIM_USDC_IN, or fork at a different block.`);
        process.exit(1);
    }
    console.log(`[demo] scored ${arb.victimDex} → ${arb.arbDex}`);
    console.log(`[demo]   base:         ${symbolOf(arb.baseToken)} (${shortAddr(arb.baseToken)})`);
    console.log(
        `[demo]   intermediate: ${symbolOf(arb.intermediateToken)} (${shortAddr(arb.intermediateToken)})`,
    );
    console.log(`[demo]   amountIn:        ${fmtAmount(arb.baseToken, arb.amountIn)}`);
    console.log(
        `[demo]   intermediateOut: ${fmtAmount(arb.intermediateToken, arb.intermediateOut)}`,
    );
    console.log(`[demo]   expectedOut:     ${fmtAmount(arb.baseToken, arb.expectedOut)}`);
    console.log(`[demo]   predicted profit: ${fmtAmount(arb.baseToken, arb.profit)}`);
    console.log(`[demo]   gas estimate:    ${arb.gasCostWei} wei`);

    // ---- 3. Execute the victim's swap ----
    banner("VICTIM EXECUTION");
    await applyVictimSwap(testClient, publicClient, victimSwap);
    await snapshotPools(publicClient);

    // ---- 4. Build flashloan bundle ----
    // The bot's tx calls Aave V3's flashLoanSimple. Aave transfers the base
    // asset to the executor, calls executor.executeOperation, the executor
    // runs the back-run round trip, approves Aave for amount + premium, and
    // Aave pulls back. No inventory required — the bot's only outlay is gas.
    banner("FLASHLOAN BUNDLE");
    const premium = (arb.amountIn * AAVE_PREMIUM_BPS) / BPS_DENOMINATOR;
    const expectedNet = arb.profit > premium ? arb.profit - premium : 0n;
    console.log(`[demo] borrowing ${fmtAmount(arb.baseToken, arb.amountIn)} from Aave V3 (${shortAddr(AAVE_V3_POOL)})`);
    console.log(`[demo] Aave premium (5 bp on ${symbolOf(arb.baseToken)}): ${fmtAmount(arb.baseToken, premium)}`);
    console.log(`[demo] expected net (profit − premium): ${fmtAmount(arb.baseToken, expectedNet)}`);

    const call = buildFlashloanCall(arb, executor);
    console.log(`[demo] target: ${call.to}`);
    console.log(`[demo] calldata: ${call.data.slice(0, 22)}…${call.data.slice(-8)} (${(call.data.length - 2) / 2} bytes)`);

    const fees = await fetchChainFees(publicClient, botAccount.address, 1, 400_000n);
    const signedTx = await signExecutorTx(ANVIL_KEY_0, call.to, call.data, fees);
    console.log(`[demo] signed tx: ${signedTx.slice(0, 22)}…${signedTx.slice(-8)}`);

    const execHash = await publicClient.request({
        method: "eth_sendRawTransaction",
        params: [signedTx],
    });
    const execReceipt = await publicClient.waitForTransactionReceipt({hash: execHash});

    if (execReceipt.status !== "success") {
        console.error(`[demo] flashloan tx reverted: ${execHash}`);
        process.exit(1);
    }
    console.log(`[demo] flashloan tx mined: ${execHash}`);
    console.log(`[demo] tx gas used:        ${execReceipt.gasUsed}`);

    // ---- 5. Verify ----
    banner("VERIFY");
    const finalBalance = (await publicClient.readContract({
        address: arb.baseToken,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [executor],
    })) as bigint;
    // Net profit = executor's final balance (started at 0, Aave's amount was
    // already pulled back together with the premium).
    const realizedNet = finalBalance;
    console.log(`[demo] executor's final ${symbolOf(arb.baseToken)} balance: ${fmtAmount(arb.baseToken, finalBalance)}`);
    console.log(`[demo] gross predicted profit:        ${fmtAmount(arb.baseToken, arb.profit)}`);
    console.log(`[demo] aave premium:                  ${fmtAmount(arb.baseToken, premium)}`);
    console.log(`[demo] net predicted profit:          ${fmtAmount(arb.baseToken, expectedNet)}`);
    console.log(`[demo] net realized profit:           ${fmtAmount(arb.baseToken, realizedNet)}`);
    const drift = expectedNet > 0n ? Number((realizedNet * 10_000n) / expectedNet) / 100 : 0;
    console.log(`[demo] prediction accuracy: ${drift.toFixed(2)}% of expected`);

    if (realizedNet <= 0n) {
        console.error(`[demo] realized net is non-positive — something's wrong.`);
        process.exit(1);
    }
    console.log(`\n[demo] ✓ end-to-end flashloan-funded pipeline complete.`);
}

// ---- Helpers ----

type AnvilTestClient = ReturnType<typeof createTestClient> &
    ReturnType<typeof publicActions> &
    ReturnType<typeof walletActions>;

async function snapshotPools(client: ReturnType<typeof createPublicClient>): Promise<void> {
    for (const [label, pair] of [
        ["UniV2", UNIV2_WETH_USDC],
        ["Sushi", SUSHI_WETH_USDC],
    ] as const) {
        const reserves = (await client.readContract({
            address: pair,
            abi: PAIR_ABI,
            functionName: "getReserves",
        })) as readonly [bigint, bigint, number];
        // token0 = USDC (lower), token1 = WETH
        console.log(
            `[demo]   ${label.padEnd(6)} ${shortAddr(pair)}  USDC=${fmtUSDC(reserves[0])}  WETH=${fmtWETH(reserves[1])}`,
        );
    }
}

async function applyVictimSwap(
    testClient: AnvilTestClient,
    publicClient: ReturnType<typeof createPublicClient>,
    swap: DecodedSwap,
): Promise<void> {
    if (swap.kind !== "exactInForTokens") {
        throw new Error("[demo] only exactInForTokens supported");
    }

    // Sanity: whale needs to actually hold the USDC we're about to transfer.
    const whaleBalance = (await publicClient.readContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [USDC_WHALE],
    })) as bigint;
    if (whaleBalance < swap.amountIn) {
        throw new Error(
            `[demo] whale ${shortAddr(USDC_WHALE)} holds only ${fmtUSDC(whaleBalance)} — need ${fmtUSDC(swap.amountIn)}. ` +
                `Switch USDC_WHALE in demo.ts, or shrink VICTIM_USDC_IN.`,
        );
    }

    // Fund the victim with USDC from a whale.
    await testClient.impersonateAccount({address: USDC_WHALE});
    await testClient.setBalance({address: USDC_WHALE, value: 10n ** 18n});
    const whaleClient = createWalletClient({
        chain: mainnet,
        transport: http(ANVIL_URL),
        account: USDC_WHALE,
    });
    const transferHash = await whaleClient.writeContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [VICTIM, swap.amountIn],
    });
    await assertSuccess(publicClient, transferHash, "whale → victim USDC transfer");
    await testClient.stopImpersonatingAccount({address: USDC_WHALE});
    console.log(`[demo] dealt ${fmtUSDC(swap.amountIn)} to victim`);

    // Impersonate victim, approve router, execute the swap.
    await testClient.impersonateAccount({address: VICTIM});
    await testClient.setBalance({address: VICTIM, value: 10n ** 18n});
    const victimClient = createWalletClient({
        chain: mainnet,
        transport: http(ANVIL_URL),
        account: VICTIM,
    });
    const approveHash = await victimClient.writeContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [UNIV2_ROUTER, 2n ** 256n - 1n],
    });
    await assertSuccess(publicClient, approveHash, "victim USDC approve");
    const swapHash = await victimClient.writeContract({
        address: UNIV2_ROUTER,
        abi: ROUTER_ABI,
        functionName: "swapExactTokensForTokens",
        args: [swap.amountIn, 0n, [...swap.path], VICTIM, swap.deadline],
    });
    await assertSuccess(publicClient, swapHash, "victim router swap");
    await testClient.stopImpersonatingAccount({address: VICTIM});
    console.log(`[demo] victim swap mined: ${swapHash}`);
}

async function assertSuccess(
    client: ReturnType<typeof createPublicClient>,
    hash: Hex,
    label: string,
): Promise<void> {
    const receipt = await client.waitForTransactionReceipt({hash});
    if (receipt.status !== "success") {
        throw new Error(`[demo] ${label} reverted (gas ${receipt.gasUsed}): ${hash}`);
    }
}


main().catch((err: Error) => {
    console.error(err);
    process.exit(1);
});
