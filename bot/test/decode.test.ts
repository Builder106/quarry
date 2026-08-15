import { describe, expect, test } from 'bun:test';
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { decodeSwap, isRouter, routerToDex } from '../src/decode';

const ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)',
]);

const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111';

describe('decodeSwap', () => {
  test('swapExactTokensForTokens round-trips', () => {
    const data: Hex = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [10n ** 18n, 1_900n * 10n ** 6n, [WETH, USDC], RECIPIENT, 1_234_567n],
    });
    const decoded = decodeSwap(data);
    expect(decoded).not.toBeNull();
    if (decoded === null || decoded.kind !== 'exactInForTokens') throw new Error('kind');
    expect(decoded.amountIn).toBe(10n ** 18n);
    expect(decoded.amountOutMin).toBe(1_900n * 10n ** 6n);
    expect(decoded.path).toEqual([WETH, USDC]);
    expect(decoded.to).toBe(RECIPIENT);
    expect(decoded.deadline).toBe(1_234_567n);
  });

  test('swapExactETHForTokens round-trips (no amountIn — comes from tx.value)', () => {
    const data: Hex = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'swapExactETHForTokens',
      args: [1_900n * 10n ** 6n, [WETH, USDC], RECIPIENT, 1n],
    });
    const decoded = decodeSwap(data);
    if (decoded === null || decoded.kind !== 'exactInETHForTokens') throw new Error('kind');
    expect(decoded.amountOutMin).toBe(1_900n * 10n ** 6n);
    expect(decoded.path).toEqual([WETH, USDC]);
  });

  test('swapTokensForExactTokens round-trips', () => {
    const data: Hex = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'swapTokensForExactTokens',
      args: [2_000n * 10n ** 6n, 11n * 10n ** 17n, [WETH, USDC], RECIPIENT, 1n],
    });
    const decoded = decodeSwap(data);
    if (decoded === null || decoded.kind !== 'exactOutForTokens') throw new Error('kind');
    expect(decoded.amountOut).toBe(2_000n * 10n ** 6n);
    expect(decoded.amountInMax).toBe(11n * 10n ** 17n);
  });

  test('returns null for unrelated calldata', () => {
    // ERC20 transfer selector + dummy args.
    const data: Hex =
      '0xa9059cbb0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000007b';
    expect(decodeSwap(data)).toBeNull();
  });

  test('returns null for malformed (too-short) calldata', () => {
    expect(decodeSwap('0xdeadbeef')).toBeNull();
    expect(decodeSwap('0x')).toBeNull();
  });
});

describe('isRouter', () => {
  test('matches Uniswap V2 router in any case', () => {
    expect(isRouter('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D')).toBe(true);
    expect(isRouter('0x7A250D5630B4CF539739DF2C5DACB4C659F2488D')).toBe(true);
    expect(isRouter('0x7a250d5630b4cf539739df2c5dacb4c659f2488d')).toBe(true);
  });

  test('matches Sushiswap router', () => {
    expect(isRouter('0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F')).toBe(true);
  });

  test('returns false for non-router addresses', () => {
    expect(isRouter('0x0000000000000000000000000000000000000000')).toBe(false);
    expect(isRouter(WETH)).toBe(false);
    expect(isRouter(null)).toBe(false);
    expect(isRouter(undefined)).toBe(false);
  });
});

describe('routerToDex', () => {
  test('maps Uniswap V2 router to uniswap-v2', () => {
    expect(routerToDex('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D')).toBe('uniswap-v2');
    expect(routerToDex('0x7a250d5630b4cf539739df2c5dacb4c659f2488d')).toBe('uniswap-v2');
  });

  test('maps Sushiswap router to sushiswap', () => {
    expect(routerToDex('0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F')).toBe('sushiswap');
  });

  test('returns null for Uniswap V3 SwapRouter (different ABI)', () => {
    // We recognize it via isRouter (to skip the getTx waste), but can't
    // back-run with the UniV2-shape pipeline.
    expect(routerToDex('0xe592427a0aece92de3edee1f18e0157c05861564')).toBeNull();
  });

  test('returns null for unknown addresses and nullish input', () => {
    expect(routerToDex('0x0000000000000000000000000000000000000000')).toBeNull();
    expect(routerToDex(null)).toBeNull();
    expect(routerToDex(undefined)).toBeNull();
  });
});
