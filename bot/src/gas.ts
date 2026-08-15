// Gas price fetcher with a one-block cache. The scanner calls this once per
// scored opportunity; the cache amortizes the RPC across a burst of pending
// transactions that fire within the same block. Without the cache, a busy
// scanner would hammer `eth_gasPrice` at ~100/s on a typical mainnet day.

import type { PublicClient } from 'viem';

const CACHE_TTL_MS = 12_000;

let cached: { at: number; gasPrice: bigint } | null = null;

/// Fetch current effective gas price in wei. Caches the result for
/// CACHE_TTL_MS (~one block) so a burst of scoring calls shares a single
/// RPC fetch.
export async function getGasPrice(client: PublicClient): Promise<bigint> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.gasPrice;
  }
  const gasPrice = await client.getGasPrice();
  cached = { at: now, gasPrice };
  return gasPrice;
}

/// Conservative bundle gas budget. The V2 Yul executor's two-hop swap
/// measures at 110,780 gas against real mainnet pools (see
/// `ExecutorFork.t.sol`); adding ~40k for flashloan setup, calldata
/// transmission, and gas-price-spike headroom lands at 150k. Tune at the
/// scoring call site if a different bundle layout (e.g. no flashloan, or a
/// JIT liquidity provider's own gas refund path) makes this materially off.
export const EXECUTOR_GAS_UNITS = 150_000n;

/// Estimated total wei cost of executing the V2 two-hop bundle at current
/// gas prices.
export async function estimateExecutorGasCost(client: PublicClient): Promise<bigint> {
  const gasPrice = await getGasPrice(client);
  return EXECUTOR_GAS_UNITS * gasPrice;
}

/// Reset the gas-price cache. Test-only — production code should rely on
/// the TTL to expire stale values naturally.
export function _resetGasCache(): void {
  cached = null;
}
