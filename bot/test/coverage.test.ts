import { describe, expect, it } from 'bun:test';
import type { Address, PublicClient } from 'viem';
import { encodeFunctionData, parseAbi } from 'viem';
import { EXECUTOR_ADDRESS_ENV, getExecutorAddress } from '../src/bundle';
import { decodeSwap } from '../src/decode';
import { _resetGasCache, estimateExecutorGasCost, EXECUTOR_GAS_UNITS, getGasPrice } from '../src/gas';
import { fetchReserves } from '../src/reserves';
import { scoreOpportunity } from '../src/score';
import { fetchChainFees } from '../src/sign';

describe('gas.ts coverage', () => {
  it('fetches gas price and uses cache within TTL', async () => {
    _resetGasCache();
    let callCount = 0;
    const mockClient = {
      getGasPrice: async () => {
        callCount++;
        return 30_000_000_000n;
      },
    } as unknown as PublicClient;

    const price1 = await getGasPrice(mockClient);
    expect(price1).toBe(30_000_000_000n);
    expect(callCount).toBe(1);

    const price2 = await getGasPrice(mockClient);
    expect(price2).toBe(30_000_000_000n);
    expect(callCount).toBe(1);

    const cost = await estimateExecutorGasCost(mockClient);
    expect(cost).toBe(EXECUTOR_GAS_UNITS * 30_000_000_000n);
  });
});

describe('reserves.ts coverage', () => {
  it('fetches reserves and filters out failures / zeroes', async () => {
    const tokenA = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address;
    const tokenB = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;

    const mockClient = {
      multicall: async () => [
        { status: 'success', result: [1000n, 2000n, 123456] },
        { status: 'failure', error: new Error('revert') },
        { status: 'success', result: [0n, 0n, 123456] },
      ],
    } as unknown as PublicClient;

    const res = await fetchReserves(mockClient, tokenA, tokenB, ['uniswap-v2', 'sushiswap']);
    expect(res.length).toBe(1);
    expect(res[0].dex).toBe('uniswap-v2');
    expect(res[0].reserve0).toBe(1000n);
    expect(res[0].reserve1).toBe(2000n);
  });
});

describe('score.ts IO coverage', () => {
  it('scoreOpportunity handles invalid kinds and path length', async () => {
    const mockClient = {} as unknown as PublicClient;
    const invalidKind = {
      kind: 'exactInETHForTokens',
      amountOutMin: 100n,
      path: ['0x1111111111111111111111111111111111111111' as Address],
      to: '0x2222222222222222222222222222222222222222' as Address,
      deadline: 99999n,
    } as const;
    const res1 = await scoreOpportunity(mockClient, invalidKind as any, 'uniswap-v2');
    expect(res1).toBeNull();

    const shortPath = {
      kind: 'exactInForTokens',
      amountIn: 100n,
      amountOutMin: 100n,
      path: ['0x1111111111111111111111111111111111111111' as Address],
      to: '0x2222222222222222222222222222222222222222' as Address,
      deadline: 99999n,
    } as const;
    const res2 = await scoreOpportunity(mockClient, shortPath, 'uniswap-v2');
    expect(res2).toBeNull();
  });

  it('scoreOpportunity runs end-to-end with mock multicall & gas', async () => {
    const tokenA = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address; // WETH
    const tokenB = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address; // USDC

    _resetGasCache();
    const mockClient = {
      getGasPrice: async () => 1_000_000_000n,
      multicall: async () => [
        // Uniswap V2 reserves: 100 WETH, 200_000 USDC
        { status: 'success', result: [100n * 10n ** 18n, 200_000n * 10n ** 6n, 123456] },
        // Sushiswap reserves: 100 WETH, 200_000 USDC
        { status: 'success', result: [100n * 10n ** 18n, 200_000n * 10n ** 6n, 123456] },
      ],
    } as unknown as PublicClient;

    const swap = {
      kind: 'exactInForTokens' as const,
      amountIn: 10n * 10n ** 18n,
      amountOutMin: 1n,
      path: [tokenA, tokenB],
      to: '0x3333333333333333333333333333333333333333' as Address,
      deadline: 99999n,
    };

    const scored = await scoreOpportunity(mockClient, swap, 'uniswap-v2');
    expect(scored).toBeDefined();
  });
});

describe('sign.ts coverage', () => {
  it('fetchChainFees queries tx count and gas price', async () => {
    const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
    const mockClient = {
      getTransactionCount: async ({ address }: { address: Address }) => 5,
      getGasPrice: async () => 20_000_000_000n,
    } as unknown as PublicClient;

    const fees = await fetchChainFees(mockClient, account, 1, 200_000n, 2_000_000_000n);
    expect(fees.chainId).toBe(1);
    expect(fees.nonce).toBe(5);
    expect(fees.gas).toBe(200_000n);
    expect(fees.maxPriorityFeePerGas).toBe(2_000_000_000n);
    expect(fees.maxFeePerGas).toBe(20_000_000_000n * 2n + 2_000_000_000n);
  });
});

describe('decode.ts coverage', () => {
  it('decodes swapExactTokensForETH', () => {
    const routerAbi = parseAbi([
      'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
    ]);
    const calldata = encodeFunctionData({
      abi: routerAbi,
      functionName: 'swapExactTokensForETH',
      args: [
        1000n,
        900n,
        [
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
          '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
        ],
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
        123456789n,
      ],
    });

    const decoded = decodeSwap(calldata);
    expect(decoded).not.toBeNull();
    expect(decoded?.kind).toBe('exactInForETH');
    if (decoded?.kind === 'exactInForETH') {
      expect(decoded.amountIn).toBe(1000n);
      expect(decoded.amountOutMin).toBe(900n);
      expect(decoded.deadline).toBe(123456789n);
    }
  });
});

describe('bundle.ts coverage', () => {
  it('getExecutorAddress gets valid address or throws on invalid / missing', () => {
    const prev = process.env[EXECUTOR_ADDRESS_ENV];
    try {
      delete process.env[EXECUTOR_ADDRESS_ENV];
      expect(() => getExecutorAddress()).toThrow('must be set to a 20-byte hex address');

      process.env[EXECUTOR_ADDRESS_ENV] = 'invalid-address';
      expect(() => getExecutorAddress()).toThrow('must be set to a 20-byte hex address');

      process.env[EXECUTOR_ADDRESS_ENV] = '0x1111111111111111111111111111111111111111';
      expect(getExecutorAddress()).toBe('0x1111111111111111111111111111111111111111');
    } finally {
      if (prev !== undefined) {
        process.env[EXECUTOR_ADDRESS_ENV] = prev;
      } else {
        delete process.env[EXECUTOR_ADDRESS_ENV];
      }
    }
  });
});
