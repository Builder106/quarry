// Multicall-based reserve fetcher. One round trip pulls `getReserves()` for
// every (token-pair, DEX) combination, returning a flat list keyed by DEX.
// Missing pairs (factory never deployed one for this token combo) come back
// as failures, which we silently filter out — callers see only the pairs
// that have on-chain state.

import { parseAbi, type Address, type PublicClient } from 'viem';
import { pairAddressFor, type Dex } from './pairs';

const PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
]);

export type RawReserves = {
  dex: Dex;
  pair: Address;
  /// Reserve of token0 — the token with the lower address.
  reserve0: bigint;
  /// Reserve of token1.
  reserve1: bigint;
};

/// Fetch reserves for `(tokenA, tokenB)` across `dexes` via Multicall3. The
/// returned array only contains DEXes whose `getReserves()` succeeded; pairs
/// that have never been deployed (or have zero reserves) are dropped.
export async function fetchReserves(
  client: PublicClient,
  tokenA: Address,
  tokenB: Address,
  dexes: readonly Dex[],
): Promise<readonly RawReserves[]> {
  const pairs = dexes.map((dex) => ({ dex, pair: pairAddressFor(dex, tokenA, tokenB) }));

  const results = await client.multicall({
    contracts: pairs.map(
      ({ pair }) =>
        ({
          address: pair,
          abi: PAIR_ABI,
          functionName: 'getReserves',
        }) as const,
    ),
    allowFailure: true,
  });

  const out: RawReserves[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const r = results[i];
    const meta = pairs[i];
    if (!r || !meta || r.status !== 'success') continue;
    const [reserve0, reserve1] = r.result;
    if (reserve0 <= 0n || reserve1 <= 0n) continue;
    out.push({ dex: meta.dex, pair: meta.pair, reserve0, reserve1 });
  }
  return out;
}
