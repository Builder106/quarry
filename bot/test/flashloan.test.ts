import { describe, expect, test } from 'bun:test';
import { decodeFunctionData, parseAbi, type Address } from 'viem';
import { AAVE_V3_POOL, buildDirectCall, buildFlashloanCall } from '../src/bundle';
import type { ScoredArb } from '../src/score';

const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const EXECUTOR: Address = '0x1111111111111111111111111111111111111111';
const PAIR_VICTIM: Address = '0xaaaaaaaa0000000000000000000000000000aaaa';
const PAIR_ARB: Address = '0xbbbbbbbb0000000000000000000000000000bbbb';

const POOL_ABI = parseAbi([
  'function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes params, uint16 referralCode)',
]);

function makeWethBaseArb(): ScoredArb {
  // Victim sells USDC for WETH on UniV2 → base is WETH.
  return {
    victimDex: 'uniswap-v2',
    arbDex: 'sushiswap',
    baseToken: WETH,
    intermediateToken: USDC,
    amountIn: 1n * 10n ** 18n,
    intermediateOut: 2_000n * 10n ** 6n,
    expectedOut: 1_100n * 10n ** 15n,
    profit: 1n * 10n ** 17n,
    victimPair: PAIR_VICTIM,
    arbPair: PAIR_ARB,
    gasCostWei: 0n,
  };
}

describe('buildFlashloanCall', () => {
  test('targets the Aave V3 mainnet pool address', () => {
    const call = buildFlashloanCall(makeWethBaseArb(), EXECUTOR);
    expect(call.to).toBe(AAVE_V3_POOL);
  });

  test('data is a valid flashLoanSimple call with the executor as receiver', () => {
    const arb = makeWethBaseArb();
    const call = buildFlashloanCall(arb, EXECUTOR);

    const decoded = decodeFunctionData({ abi: POOL_ABI, data: call.data });
    expect(decoded.functionName).toBe('flashLoanSimple');

    const [receiver, asset, amount, params, referralCode] = decoded.args;
    expect(receiver).toBe(EXECUTOR);
    expect(asset).toBe(arb.baseToken);
    expect(amount).toBe(arb.amountIn);
    expect(referralCode).toBe(0);
    // Params length: 220 bytes packed payload (440 hex chars + 0x).
    expect((params as `0x${string}`).length).toBe(442);
  });

  test("params embedded in flashLoanSimple matches a direct call's calldata", () => {
    // The packed 220-byte payload should be identical between the
    // direct path (which sends it as tx.data) and the flashloan path
    // (which sends it as the `params` arg). Same safetyBps applied.
    const arb = makeWethBaseArb();
    const direct = buildDirectCall(arb, EXECUTOR);
    const flash = buildFlashloanCall(arb, EXECUTOR);
    const [, , , params] = decodeFunctionData({ abi: POOL_ABI, data: flash.data }).args;
    expect(params).toBe(direct.data);
  });

  test('propagates safetyBps + minProfit options through to the inner calldata', () => {
    const arb = makeWethBaseArb();
    const flash = buildFlashloanCall(arb, EXECUTOR, { safetyBps: 50n, minProfit: 12_345n });
    const direct = buildDirectCall(arb, EXECUTOR, { safetyBps: 50n, minProfit: 12_345n });
    const [, , , params] = decodeFunctionData({ abi: POOL_ABI, data: flash.data }).args;
    expect(params).toBe(direct.data);
  });
});

describe('buildDirectCall', () => {
  test('returns to=executor and data=packed calldata', () => {
    const arb = makeWethBaseArb();
    const call = buildDirectCall(arb, EXECUTOR);
    expect(call.to).toBe(EXECUTOR);
    // 220-byte packed payload.
    expect(call.data.length).toBe(442);
  });
});
