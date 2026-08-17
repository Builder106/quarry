import { describe, expect, test } from 'bun:test';
import type { Address } from 'viem';
import { pairAddressFor, sortTokens } from '../src/pairs';

const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

// Known mainnet pair addresses — these are deterministic from CREATE2 and
// have been the canonical Uniswap V2 / Sushi WETH-paired pools for years.
const UNIV2_WETH_USDC: Address = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc';
const SUSHI_WETH_USDC: Address = '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0';
const UNIV2_DAI_WETH: Address = '0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11';

describe('sortTokens', () => {
  test('orders by numerical address value', () => {
    const [t0, t1] = sortTokens(WETH, USDC);
    // USDC has the lower address.
    expect(t0).toBe(USDC);
    expect(t1).toBe(WETH);
  });

  test("is commutative — order of arguments doesn't matter", () => {
    const [a0, a1] = sortTokens(WETH, USDC);
    const [b0, b1] = sortTokens(USDC, WETH);
    expect(a0).toBe(b0);
    expect(a1).toBe(b1);
  });
});

describe('pairAddressFor', () => {
  test('Uniswap V2 WETH/USDC matches the known mainnet pair', () => {
    expect(pairAddressFor('uniswap-v2', WETH, USDC)).toBe(UNIV2_WETH_USDC);
  });

  test('Sushiswap WETH/USDC matches the known mainnet pair', () => {
    expect(pairAddressFor('sushiswap', WETH, USDC)).toBe(SUSHI_WETH_USDC);
  });

  test('Uniswap V2 DAI/WETH matches the known mainnet pair', () => {
    expect(pairAddressFor('uniswap-v2', DAI, WETH)).toBe(UNIV2_DAI_WETH);
  });

  test("token order doesn't affect the computed address", () => {
    expect(pairAddressFor('uniswap-v2', WETH, USDC)).toBe(pairAddressFor('uniswap-v2', USDC, WETH));
  });

  test('different DEXes produce different addresses for the same pair', () => {
    expect(pairAddressFor('uniswap-v2', WETH, USDC)).not.toBe(
      pairAddressFor('sushiswap', WETH, USDC),
    );
  });
});
