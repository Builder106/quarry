// Uniswap V2 router calldata decoder. Handles the four router methods that
// account for >95% of public-mempool swap volume. ETH-variant inputs are
// callers' responsibility — `amountIn` for `swapExactETHForTokens` lives in
// `tx.value`, not the calldata, so the scanner fills it post-decode.

import { decodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import type { Dex } from './pairs';

const ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)',
]);

export type DecodedSwap =
  | {
      kind: 'exactInForTokens';
      amountIn: bigint;
      amountOutMin: bigint;
      path: readonly Address[];
      to: Address;
      deadline: bigint;
    }
  | {
      kind: 'exactInETHForTokens';
      amountOutMin: bigint;
      path: readonly Address[];
      to: Address;
      deadline: bigint;
    }
  | {
      kind: 'exactInForETH';
      amountIn: bigint;
      amountOutMin: bigint;
      path: readonly Address[];
      to: Address;
      deadline: bigint;
    }
  | {
      kind: 'exactOutForTokens';
      amountOut: bigint;
      amountInMax: bigint;
      path: readonly Address[];
      to: Address;
      deadline: bigint;
    };

/// Decode a Uniswap V2-shaped router call. Returns null on selector miss or
/// malformed calldata — callers should treat null as "not interesting,"
/// not as an error, since most pending txs aren't swaps.
export function decodeSwap(calldata: Hex): DecodedSwap | null {
  try {
    const decoded = decodeFunctionData({ abi: ROUTER_ABI, data: calldata });
    switch (decoded.functionName) {
      case 'swapExactTokensForTokens': {
        const [amountIn, amountOutMin, path, to, deadline] = decoded.args;
        return { kind: 'exactInForTokens', amountIn, amountOutMin, path, to, deadline };
      }
      case 'swapExactETHForTokens': {
        const [amountOutMin, path, to, deadline] = decoded.args;
        return { kind: 'exactInETHForTokens', amountOutMin, path, to, deadline };
      }
      case 'swapExactTokensForETH': {
        const [amountIn, amountOutMin, path, to, deadline] = decoded.args;
        return { kind: 'exactInForETH', amountIn, amountOutMin, path, to, deadline };
      }
      case 'swapTokensForExactTokens': {
        const [amountOut, amountInMax, path, to, deadline] = decoded.args;
        return { kind: 'exactOutForTokens', amountOut, amountInMax, path, to, deadline };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/// Known mainnet routers we treat as "swap-bearing." Addresses are stored
/// lowercased — viem returns checksummed casing from `tx.to`, so callers
/// must lowercase before checking. `isRouter` does that for you.
export const ROUTERS: ReadonlySet<string> = new Set([
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2 Router 02
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', // Sushiswap Router
  '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3 SwapRouter (different ABI; included so we don't waste a getTx)
]);

export function isRouter(address: string | null | undefined): boolean {
  if (!address) return false;
  return ROUTERS.has(address.toLowerCase());
}

/// Map a router contract address to the DEX whose pairs it routes through.
/// Returns null for routers we recognize but can't back-run with the
/// UniV2-shaped pipeline (Uniswap V3's SwapRouter has a different pair
/// shape — its concentrated-liquidity math is out of scope for now).
export function routerToDex(address: string | null | undefined): Dex | null {
  if (!address) return null;
  switch (address.toLowerCase()) {
    case '0x7a250d5630b4cf539739df2c5dacb4c659f2488d':
      return 'uniswap-v2';
    case '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f':
      return 'sushiswap';
    default:
      return null;
  }
}
