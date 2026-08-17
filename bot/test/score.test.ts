import { describe, expect, test } from 'bun:test';
import type { Address } from 'viem';
import type { DecodedSwap } from '../src/decode';
import type { RawReserves } from '../src/reserves';
import { scoreFromRawReserves } from '../src/score';

const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const PAIR_UNIV2: Address = '0xAAAAaaaA0000000000000000000000000000aaaa';
const PAIR_SUSHI: Address = '0xBBBbbbBb0000000000000000000000000000bbbb';

// Token-order: USDC (lower) = token0, WETH (higher) = token1.
// Convention: `reserve0` = USDC, `reserve1` = WETH for these pairs.
//
// All scenarios start both pools at the same price (2000 USDC per WETH) so
// "is there an arb" hinges entirely on the victim's price move, not on
// pre-existing divergence.
const BASELINE_USDC = 2_000_000n * 10n ** 6n;
const BASELINE_WETH = 1_000n * 10n ** 18n;

function bothPoolsAt(reserve0: bigint, reserve1: bigint): RawReserves[] {
  return [
    { dex: 'uniswap-v2', pair: PAIR_UNIV2, reserve0, reserve1 },
    { dex: 'sushiswap', pair: PAIR_SUSHI, reserve0, reserve1 },
  ];
}

function exactInSwap(amountIn: bigint, path: readonly Address[]): DecodedSwap {
  return {
    kind: 'exactInForTokens',
    amountIn,
    amountOutMin: 0n,
    path,
    to: '0x1111111111111111111111111111111111111111',
    deadline: 0n,
  };
}

describe('scoreFromRawReserves (back-run)', () => {
  test('tiny victim swap on aligned pools → no back-run covers fees', () => {
    // Victim swaps 0.01 WETH for USDC. Price move on victim's pool is
    // ~0.001%, way below the combined ~0.6% round-trip fee.
    const raw = bothPoolsAt(BASELINE_USDC, BASELINE_WETH);
    const swap = exactInSwap(10n ** 16n, [WETH, USDC]);
    expect(scoreFromRawReserves(swap, 'uniswap-v2', raw, 0n)).toBeNull();
  });

  test('large victim swap creates a profitable back-run', () => {
    // Victim swaps 100 WETH for USDC on Uniswap V2 — moves price ~10%
    // on that pool. Sushi unchanged. Back-runner deposits USDC on UniV2,
    // gets WETH cheaply, sells on Sushi.
    const raw = bothPoolsAt(BASELINE_USDC, BASELINE_WETH);
    const swap = exactInSwap(100n * 10n ** 18n, [WETH, USDC]);
    const scored = scoreFromRawReserves(swap, 'uniswap-v2', raw, 0n);
    expect(scored).not.toBeNull();
    if (!scored) throw new Error('scored is null');
    expect(scored.victimDex).toBe('uniswap-v2');
    expect(scored.arbDex).toBe('sushiswap');
    // Base = USDC (the token the victim received).
    expect(scored.baseToken).toBe(USDC);
    expect(scored.intermediateToken).toBe(WETH);
    expect(scored.profit).toBeGreaterThan(0n);
    expect(scored.expectedOut).toBeGreaterThan(scored.amountIn);
    expect(scored.victimPair).toBe(PAIR_UNIV2);
    expect(scored.arbPair).toBe(PAIR_SUSHI);
    expect(scored.gasCostWei).toBe(0n);
  });

  test('profit grows with victim impact (monotone in amountIn)', () => {
    const raw = bothPoolsAt(BASELINE_USDC, BASELINE_WETH);
    const small = scoreFromRawReserves(
      exactInSwap(50n * 10n ** 18n, [WETH, USDC]),
      'uniswap-v2',
      raw,
      0n,
    );
    const large = scoreFromRawReserves(
      exactInSwap(200n * 10n ** 18n, [WETH, USDC]),
      'uniswap-v2',
      raw,
      0n,
    );
    if (!small || !large) throw new Error('both should score');
    expect(large.profit).toBeGreaterThan(small.profit);
  });

  test('victimDex flips correctly when sushi is the victim', () => {
    // Same large swap, but the victim's router this time is Sushi.
    // Back-runner now deposits on Sushi, sells on UniV2.
    const raw = bothPoolsAt(BASELINE_USDC, BASELINE_WETH);
    const swap = exactInSwap(100n * 10n ** 18n, [WETH, USDC]);
    const scored = scoreFromRawReserves(swap, 'sushiswap', raw, 0n);
    if (!scored) throw new Error('scored is null');
    expect(scored.victimDex).toBe('sushiswap');
    expect(scored.arbDex).toBe('uniswap-v2');
  });

  test("returns null when victimDex isn't in raw reserves", () => {
    const raw: RawReserves[] = [
      { dex: 'sushiswap', pair: PAIR_SUSHI, reserve0: BASELINE_USDC, reserve1: BASELINE_WETH },
    ];
    const swap = exactInSwap(100n * 10n ** 18n, [WETH, USDC]);
    expect(scoreFromRawReserves(swap, 'uniswap-v2', raw, 0n)).toBeNull();
  });

  test('returns null when only victim DEX has reserves (no counter)', () => {
    const raw: RawReserves[] = [
      { dex: 'uniswap-v2', pair: PAIR_UNIV2, reserve0: BASELINE_USDC, reserve1: BASELINE_WETH },
    ];
    const swap = exactInSwap(100n * 10n ** 18n, [WETH, USDC]);
    expect(scoreFromRawReserves(swap, 'uniswap-v2', raw, 0n)).toBeNull();
  });

  test('returns null for non-exactIn swap kind', () => {
    const raw = bothPoolsAt(BASELINE_USDC, BASELINE_WETH);
    const swap: DecodedSwap = {
      kind: 'exactOutForTokens',
      amountOut: 1_000n * 10n ** 6n,
      amountInMax: 1n * 10n ** 18n,
      path: [WETH, USDC],
      to: '0x1111111111111111111111111111111111111111',
      deadline: 0n,
    };
    expect(scoreFromRawReserves(swap, 'uniswap-v2', raw, 0n)).toBeNull();
  });

  test('returns null for malformed path (< 2 tokens)', () => {
    const raw = bothPoolsAt(BASELINE_USDC, BASELINE_WETH);
    expect(scoreFromRawReserves(exactInSwap(10n ** 18n, [WETH]), 'uniswap-v2', raw, 0n)).toBeNull();
    expect(scoreFromRawReserves(exactInSwap(10n ** 18n, []), 'uniswap-v2', raw, 0n)).toBeNull();
  });
});

describe('scoreFromRawReserves gas-cost gate (WETH base)', () => {
  // Victim sells USDC for WETH → baseToken = WETH, gate applies.
  // Same pool sizes; a large enough victim creates a profitable back-run.
  const raw = bothPoolsAt(BASELINE_USDC, BASELINE_WETH);
  const victimUsdcIn = 1_000_000n * 10n ** 6n; // 1M USDC — meaningful move

  test('WETH-base: arb surfaces when profit exceeds gas cost', () => {
    const swap = exactInSwap(victimUsdcIn, [USDC, WETH]);
    const scored = scoreFromRawReserves(swap, 'uniswap-v2', raw, 0n);
    if (!scored) throw new Error('scored is null');
    expect(scored.baseToken).toBe(WETH);
    expect(scored.profit).toBeGreaterThan(0n);
    // Now re-score with a gas cost just below the realized profit — still surfaces.
    const justBelow = scored.profit - 1n;
    const scoredAtBudget = scoreFromRawReserves(swap, 'uniswap-v2', raw, justBelow);
    expect(scoredAtBudget).not.toBeNull();
    expect(scoredAtBudget?.gasCostWei).toBe(justBelow);
  });

  test('WETH-base: gate drops the arb when gas cost equals or exceeds profit', () => {
    const swap = exactInSwap(victimUsdcIn, [USDC, WETH]);
    const baseline = scoreFromRawReserves(swap, 'uniswap-v2', raw, 0n);
    if (!baseline) throw new Error('baseline is null');
    // Gas cost ≥ profit → null. Test both boundaries (equal, and strictly greater).
    expect(scoreFromRawReserves(swap, 'uniswap-v2', raw, baseline.profit)).toBeNull();
    expect(scoreFromRawReserves(swap, 'uniswap-v2', raw, baseline.profit + 1n)).toBeNull();
  });

  test('non-WETH base (USDC): gate is skipped, profit propagates regardless', () => {
    // Victim sells WETH for USDC → baseToken = USDC. The V0 gate doesn't
    // know how to convert ETH gas cost to USDC, so it lets the arb
    // through whatever the gas number is.
    const swap = exactInSwap(100n * 10n ** 18n, [WETH, USDC]);
    const enormousGas = 10n ** 30n;
    const scored = scoreFromRawReserves(swap, 'uniswap-v2', raw, enormousGas);
    if (!scored) throw new Error('scored is null');
    expect(scored.baseToken).toBe(USDC);
    expect(scored.profit).toBeGreaterThan(0n);
    // gasCostWei is still carried through so downstream can convert.
    expect(scored.gasCostWei).toBe(enormousGas);
  });
});
