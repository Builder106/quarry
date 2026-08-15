import { describe, expect, test } from 'bun:test';
import { getAmountOut, getOptimalInput, isqrt, quoteOptimalArb, quoteRoundTrip } from '../src/amm';

describe('isqrt', () => {
  test('returns 0 for 0, 1 for 1', () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
  });

  test('matches Math.sqrt for small values', () => {
    for (let i = 2n; i < 1_000n; i++) {
      const r = isqrt(i);
      // Floor sqrt: r² ≤ i < (r+1)²
      expect(r * r).toBeLessThanOrEqual(i);
      expect((r + 1n) * (r + 1n)).toBeGreaterThan(i);
    }
  });

  test('handles uint256-scale values', () => {
    const big = 10n ** 50n;
    const r = isqrt(big);
    expect(r * r).toBeLessThanOrEqual(big);
    expect((r + 1n) * (r + 1n)).toBeGreaterThan(big);
  });

  test('throws on negative input', () => {
    expect(() => isqrt(-1n)).toThrow();
  });
});

describe('getAmountOut', () => {
  test('matches Uniswap V2 spec for a known case', () => {
    // From Uniswap V2's own router test: 1 token in, 5 reserve in, 10 reserve out.
    // amountInWithFee = 1 * 997 = 997
    // numerator = 997 * 10 = 9_970
    // denominator = 5 * 1_000 + 997 = 5_997
    // expected = 9_970 / 5_997 = 1 (floor)
    expect(getAmountOut(1n, 5n, 10n)).toBe(1n);
  });

  test('realistic mainnet-scale reserves (WETH/USDC)', () => {
    // 1 WETH into a pool with 1_000 WETH and 2_000_000 USDC reserves
    // → expect a bit under 2_000 USDC (slippage + fee).
    const out = getAmountOut(10n ** 18n, 1_000n * 10n ** 18n, 2_000_000n * 10n ** 6n);
    // Sanity: between 1_900 USDC and 2_000 USDC.
    expect(out).toBeGreaterThan(1_900n * 10n ** 6n);
    expect(out).toBeLessThan(2_000n * 10n ** 6n);
  });

  test('returns 0 for zero/negative input or reserves', () => {
    expect(getAmountOut(0n, 100n, 100n)).toBe(0n);
    expect(getAmountOut(1n, 0n, 100n)).toBe(0n);
    expect(getAmountOut(1n, 100n, 0n)).toBe(0n);
    expect(getAmountOut(-1n, 100n, 100n)).toBe(0n);
  });
});

describe('getOptimalInput / quoteOptimalArb', () => {
  test('returns 0 when both pools have identical prices (no arb)', () => {
    // Same reserve ratios → no price difference to exploit.
    const pool1 = { reserveIn: 1_000n * 10n ** 18n, reserveOut: 2_000_000n * 10n ** 6n };
    const pool2 = { reserveIn: 2_000_000n * 10n ** 6n, reserveOut: 1_000n * 10n ** 18n };
    expect(getOptimalInput(pool1, pool2)).toBe(0n);
    expect(quoteOptimalArb(pool1, pool2).profit).toBe(0n);
  });

  test('returns 0 when the price gap is smaller than the round-trip fee', () => {
    // Convention: pool1 is where we sell WETH (high USDC/WETH ratio);
    // pool2 is where we buy WETH back (low USDC/WETH ratio). The 0.4% gap
    // between 2008 and 2000 is below the combined ~0.6% fee.
    const pool1 = { reserveIn: 1_000n * 10n ** 18n, reserveOut: 2_008_000n * 10n ** 6n };
    const pool2 = { reserveIn: 2_000_000n * 10n ** 6n, reserveOut: 1_000n * 10n ** 18n };
    expect(getOptimalInput(pool1, pool2)).toBe(0n);
  });

  test('returns a positive input when the price gap exceeds fees', () => {
    // pool1 sells WETH at 2060 USDC/WETH, pool2 buys WETH at 2000 USDC/WETH.
    // 3% gap easily covers the combined 0.6% fees.
    const pool1 = { reserveIn: 1_000n * 10n ** 18n, reserveOut: 2_060_000n * 10n ** 6n };
    const pool2 = { reserveIn: 2_000_000n * 10n ** 6n, reserveOut: 1_000n * 10n ** 18n };
    const { amountIn, expectedOut, profit } = quoteOptimalArb(pool1, pool2);
    expect(amountIn).toBeGreaterThan(0n);
    expect(expectedOut).toBeGreaterThan(amountIn);
    expect(profit).toBeGreaterThan(0n);
  });

  test('optimal x* is a local maximum of profit', () => {
    const pool1 = { reserveIn: 1_000n * 10n ** 18n, reserveOut: 2_060_000n * 10n ** 6n };
    const pool2 = { reserveIn: 2_000_000n * 10n ** 6n, reserveOut: 1_000n * 10n ** 18n };
    const xStar = getOptimalInput(pool1, pool2);
    const profitAt = (x: bigint): bigint => {
      const out = quoteRoundTrip(x, pool1, pool2);
      return out > x ? out - x : 0n;
    };
    const pStar = profitAt(xStar);
    // Profit at the optimum must dominate profit at ±5% offsets.
    const delta = xStar / 20n;
    expect(pStar).toBeGreaterThanOrEqual(profitAt(xStar - delta));
    expect(pStar).toBeGreaterThanOrEqual(profitAt(xStar + delta));
  });
});

describe('quoteRoundTrip', () => {
  test('equals 0 when amountIn is 0', () => {
    const p = { reserveIn: 1_000n, reserveOut: 1_000n };
    expect(quoteRoundTrip(0n, p, p)).toBe(0n);
  });

  test('round trip through equal pools loses to fees (≈0.6%)', () => {
    const pool = { reserveIn: 1_000_000n * 10n ** 18n, reserveOut: 1_000_000n * 10n ** 18n };
    const amountIn = 10n ** 18n; // 1 unit
    const out = quoteRoundTrip(amountIn, pool, {
      reserveIn: pool.reserveOut,
      reserveOut: pool.reserveIn,
    });
    // Two 0.3% fees compound to ≈0.5991% — out should be ~0.9940 of input.
    expect(out).toBeLessThan(amountIn);
    // But still above 99.3% (fees can't be more than ~0.7% combined).
    expect((out * 10_000n) / amountIn).toBeGreaterThanOrEqual(9_930n);
  });
});
