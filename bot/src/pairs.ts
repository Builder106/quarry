// Deterministic Uniswap-V2-style pair address computation. Both Uniswap V2
// and Sushiswap deploy pairs via CREATE2 from a factory, with a salt =
// keccak256(token0 || token1) and a per-factory init code hash. The result
// is computable off-chain without any RPC call — useful for cheap
// "does this pair even exist?" scanning before paying for a multicall.

import { encodePacked, getCreate2Address, keccak256, type Address, type Hex } from 'viem';

export type Dex = 'uniswap-v2' | 'sushiswap';

type DexConfig = { readonly factory: Address; readonly initCodeHash: Hex };

const DEX_CONFIG: Readonly<Record<Dex, DexConfig>> = {
  'uniswap-v2': {
    factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    initCodeHash: '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
  },
  sushiswap: {
    factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
    initCodeHash: '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
  },
};

/// Canonical token0/token1 ordering per Uniswap V2 spec: token0 is the
/// address with the lower numerical value. Mixed-case checksums are fine —
/// BigInt() parses hex case-insensitively, and the packed encoding uses
/// raw bytes downstream.
export function sortTokens(a: Address, b: Address): readonly [Address, Address] {
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

/// Compute the CREATE2 pair address for a DEX. Independent of any RPC —
/// the address exists whether or not the pair has been deployed; callers
/// should treat a zero-reserve `getReserves()` as the "no liquidity" signal.
export function pairAddressFor(dex: Dex, tokenA: Address, tokenB: Address): Address {
  const { factory, initCodeHash } = DEX_CONFIG[dex];
  const [token0, token1] = sortTokens(tokenA, tokenB);
  const salt = keccak256(encodePacked(['address', 'address'], [token0, token1]));
  return getCreate2Address({ from: factory, salt, bytecodeHash: initCodeHash });
}

export const DEXES: readonly Dex[] = ['uniswap-v2', 'sushiswap'];
