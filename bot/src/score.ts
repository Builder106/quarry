// Back-run scoring. Given a decoded victim swap and the DEX it's targeting,
// apply the swap to the victim DEX's reserves to get the post-victim state,
// then score a B → A → B round trip where:
//   - leg 1 (B → A) runs on the victim's pool at the post-victim rate
//   - leg 2 (A → B) runs on the unchanged counter DEX
//
// We measure profit in B: the token the victim received and that got more
// expensive on the victim's pool. The back-runner deposits B (cheaply now,
// because A is abundant in victim's pool) to take A, then sells A on the
// counter pool at the still-current rate. The arb direction is determined
// by the victim's trade; we don't try the reverse.
//
// Gas-cost gate: when the back-runner's base token is WETH, we compare the
// profit (also in WETH) against the bundle's gas cost in wei. If profit
// does not exceed gas, the opportunity is dropped. Non-WETH base tokens
// skip the gas gate because cross-asset price conversion to ETH is not performed here.

import type { Address, PublicClient } from 'viem';
import { getAmountOut, quoteOptimalArb, type PoolReserves } from './amm';
import type { DecodedSwap } from './decode';
import { estimateExecutorGasCost } from './gas';
import { DEXES, sortTokens, type Dex } from './pairs';
import { fetchReserves, type RawReserves } from './reserves';

/// Mainnet WETH. Lowercased once at module load for cheap repeated
/// comparison against `swap.path[1]` casing.
const WETH_LOWER = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

export type ScoredArb = {
  /// The DEX the victim's swap moves price on. Our leg-1 trades here at
  /// the post-victim rate.
  victimDex: Dex;
  /// The unchanged DEX our leg-2 closes the loop against.
  arbDex: Dex;
  /// What the back-runner has capital in and measures profit in (= what
  /// the victim received).
  baseToken: Address;
  /// The other token in the pair (= what the victim sold).
  intermediateToken: Address;
  /// Input to leg 1 (deposited into victimPair).
  amountIn: bigint;
  /// Output of leg 1 / input to leg 2 (the intermediateToken amount that
  /// flows directly from victimPair to arbPair in the executor's bundle).
  /// The bundle builder needs this to fill the amount slots in the V2
  /// executor's packed calldata.
  intermediateOut: bigint;
  /// Output of leg 2 (= amountIn + profit, the baseToken the executor
  /// receives back at the end of the round trip).
  expectedOut: bigint;
  profit: bigint;
  victimPair: Address;
  arbPair: Address;
  /// Estimated gas cost for the executor's two-hop call, in wei.
  gasCostWei: bigint;
};

function orient(raw: RawReserves, tokenIn: Address, tokenOut: Address): PoolReserves {
  const [token0] = sortTokens(tokenIn, tokenOut);
  const inIsToken0 = BigInt(tokenIn) === BigInt(token0);
  return {
    reserveIn: inIsToken0 ? raw.reserve0 : raw.reserve1,
    reserveOut: inIsToken0 ? raw.reserve1 : raw.reserve0,
  };
}

/// Pure scoring: no IO. Applies the victim's swap to its DEX's reserves,
/// then scores the back-run round trip against each available counter DEX.
/// Returns the highest-profit result, or null if no opportunity covers
/// fees and (for WETH-base trades) gas.
export function scoreFromRawReserves(
  swap: DecodedSwap,
  victimDex: Dex,
  raw: readonly RawReserves[],
  gasCostWei: bigint
): ScoredArb | null {
  if (swap.kind !== 'exactInForTokens') return null;
  if (swap.path.length < 2) return null;
  const tokenA = swap.path[0];
  const tokenB = swap.path[1];
  if (!tokenA || !tokenB) return null;

  const victim = raw.find(r => r.dex === victimDex);
  if (!victim) return null;

  const victimOriented = orient(victim, tokenA, tokenB);
  const victimOut = getAmountOut(
    swap.amountIn,
    victimOriented.reserveIn,
    victimOriented.reserveOut
  );
  if (victimOut <= 0n) return null;
  const postVictimAReserve = victimOriented.reserveIn + swap.amountIn;
  const postVictimBReserve = victimOriented.reserveOut - victimOut;
  if (postVictimBReserve <= 0n) return null;

  const leg1: PoolReserves = { reserveIn: postVictimBReserve, reserveOut: postVictimAReserve };

  let best: ScoredArb | null = null;
  for (const counter of raw) {
    if (counter.dex === victimDex) continue;
    const leg2: PoolReserves = orient(counter, tokenA, tokenB);
    const { amountIn, expectedOut, profit } = quoteOptimalArb(leg1, leg2);
    if (profit <= 0n) continue;
    if (best === null || profit > best.profit) {
      const intermediateOut = getAmountOut(amountIn, leg1.reserveIn, leg1.reserveOut);
      best = {
        victimDex,
        arbDex: counter.dex,
        baseToken: tokenB,
        intermediateToken: tokenA,
        amountIn,
        intermediateOut,
        expectedOut,
        profit,
        victimPair: victim.pair,
        arbPair: counter.pair,
        gasCostWei,
      };
    }
  }
  if (best === null) return null;

  // Gas-cost gate: WETH base profit is measured in wei for direct comparison.
  const isWethBase = best.baseToken.toLowerCase() === WETH_LOWER;
  if (isWethBase && best.profit <= gasCostWei) return null;

  return best;
}

/// IO wrapper: fetches reserves and gas price in parallel, delegates to
/// the pure scorer.
export async function scoreOpportunity(
  client: PublicClient,
  swap: DecodedSwap,
  victimDex: Dex
): Promise<ScoredArb | null> {
  if (swap.kind !== 'exactInForTokens') return null;
  if (swap.path.length < 2) return null;
  const tokenA = swap.path[0];
  const tokenB = swap.path[1];
  if (!tokenA || !tokenB) return null;

  const [raw, gasCostWei] = await Promise.all([
    fetchReserves(client, tokenA, tokenB, DEXES),
    estimateExecutorGasCost(client),
  ]);
  return scoreFromRawReserves(swap, victimDex, raw, gasCostWei);
}
