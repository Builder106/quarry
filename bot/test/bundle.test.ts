import { describe, expect, test } from 'bun:test';
import type { Address, Hex } from 'viem';
import {
  buildBundlePayload,
  buildExecutorCalldata,
  toCallBundleRequest,
  toJsonRpcRequest,
} from '../src/bundle';
import type { ScoredArb } from '../src/score';

const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// All-lowercase test addresses — viem treats them as "no EIP-55 claim" and
// accepts them in `encodePacked`. Real mainnet addresses (WETH/USDC above)
// already carry valid checksums.
const PAIR_VICTIM: Address = '0xaaaaaaaa0000000000000000000000000000aaaa';
const PAIR_ARB: Address = '0xbbbbbbbb0000000000000000000000000000bbbb';

function makeArb(overrides: Partial<ScoredArb> = {}): ScoredArb {
  return {
    victimDex: 'uniswap-v2',
    arbDex: 'sushiswap',
    baseToken: USDC,
    intermediateToken: WETH,
    amountIn: 2_000n * 10n ** 6n,
    intermediateOut: 1n * 10n ** 18n,
    expectedOut: 2_050n * 10n ** 6n,
    profit: 50n * 10n ** 6n,
    victimPair: PAIR_VICTIM,
    arbPair: PAIR_ARB,
    gasCostWei: 0n,
    ...overrides,
  };
}

// Slice a hex string (without 0x prefix) into byte ranges. Each byte = 2 chars.
function sliceBytes(hex: Hex, fromByte: number, lenBytes: number): string {
  const body = hex.slice(2); // strip 0x
  return body.slice(fromByte * 2, (fromByte + lenBytes) * 2);
}

describe('buildExecutorCalldata', () => {
  test('emits 220 bytes total', () => {
    const calldata = buildExecutorCalldata(makeArb());
    // 220 bytes = 440 hex chars + "0x" prefix = 442.
    expect(calldata.length).toBe(442);
  });

  test('pool1 lives in bytes 0..20', () => {
    const calldata = buildExecutorCalldata(makeArb());
    expect('0x' + sliceBytes(calldata, 0, 20)).toBe(PAIR_VICTIM.toLowerCase());
  });

  test('pool2 lives in bytes 20..40', () => {
    const calldata = buildExecutorCalldata(makeArb());
    expect('0x' + sliceBytes(calldata, 20, 20)).toBe(PAIR_ARB.toLowerCase());
  });

  test('tokenIn lives in bytes 168..188 and matches baseToken', () => {
    const calldata = buildExecutorCalldata(makeArb());
    expect('0x' + sliceBytes(calldata, 168, 20)).toBe(USDC.toLowerCase());
  });

  test('amount slots match token ordering: USDC base + WETH intermediate', () => {
    // USDC < WETH numerically, so USDC = token0, WETH = token1.
    // Intermediate (WETH) is token1 → intermediateIsToken0 = false.
    //
    // Leg 1: receive WETH (token1) → amount0OutP1 = 0, amount1OutP1 = intermediateOut.
    // Leg 2: receive USDC (token0) → amount0OutP2 = expectedOut, amount1OutP2 = 0.
    const arb = makeArb();
    // Use safetyBps=0 to compare against the raw arb amounts.
    const calldata = buildExecutorCalldata(arb, { safetyBps: 0n });

    const a0p1 = BigInt('0x' + sliceBytes(calldata, 40, 32));
    const a1p1 = BigInt('0x' + sliceBytes(calldata, 72, 32));
    const a0p2 = BigInt('0x' + sliceBytes(calldata, 104, 32));
    const a1p2 = BigInt('0x' + sliceBytes(calldata, 136, 32));

    expect(a0p1).toBe(0n);
    expect(a1p1).toBe(arb.intermediateOut);
    expect(a0p2).toBe(arb.expectedOut);
    expect(a1p2).toBe(0n);
  });

  test('amount slots flip when the intermediate is token0 instead', () => {
    // Base = WETH, intermediate = USDC → USDC (lower) is still token0.
    // Now intermediateIsToken0 = true.
    // Leg 1: receive USDC (token0) → amount0OutP1 = intermediateOut, amount1OutP1 = 0.
    // Leg 2: receive WETH (token1) → amount0OutP2 = 0, amount1OutP2 = expectedOut.
    const arb = makeArb({ baseToken: WETH, intermediateToken: USDC });
    const calldata = buildExecutorCalldata(arb, { safetyBps: 0n });

    const a0p1 = BigInt('0x' + sliceBytes(calldata, 40, 32));
    const a1p1 = BigInt('0x' + sliceBytes(calldata, 72, 32));
    const a0p2 = BigInt('0x' + sliceBytes(calldata, 104, 32));
    const a1p2 = BigInt('0x' + sliceBytes(calldata, 136, 32));

    expect(a0p1).toBe(arb.intermediateOut);
    expect(a1p1).toBe(0n);
    expect(a0p2).toBe(0n);
    expect(a1p2).toBe(arb.expectedOut);
  });

  test('minProfit defaults to 0 and lives in bytes 188..220', () => {
    const calldata = buildExecutorCalldata(makeArb());
    const mp = BigInt('0x' + sliceBytes(calldata, 188, 32));
    expect(mp).toBe(0n);
  });

  test('explicit minProfit is embedded correctly', () => {
    const calldata = buildExecutorCalldata(makeArb(), { minProfit: 12_345n });
    const mp = BigInt('0x' + sliceBytes(calldata, 188, 32));
    expect(mp).toBe(12_345n);
  });

  test('default safetyBps shaves both leg outputs by 1 bp', () => {
    const arb = makeArb({ intermediateOut: 10_000n * 10n ** 18n, expectedOut: 2_050n * 10n ** 6n });
    const calldata = buildExecutorCalldata(arb); // defaults: safetyBps=1, minProfit=0
    // intermediate is WETH (token1) → amount1OutP1 carries it.
    // base is USDC (token0)        → amount0OutP2 carries it.
    const a1p1 = BigInt('0x' + sliceBytes(calldata, 72, 32));
    const a0p2 = BigInt('0x' + sliceBytes(calldata, 104, 32));
    // 1 bp = 0.01% = /10_000.
    expect(a1p1).toBe(arb.intermediateOut - arb.intermediateOut / 10_000n);
    expect(a0p2).toBe(arb.expectedOut - arb.expectedOut / 10_000n);
  });

  test('explicit safetyBps=50 shaves by 50 bp on both legs', () => {
    const arb = makeArb({ intermediateOut: 10_000n * 10n ** 18n, expectedOut: 2_050n * 10n ** 6n });
    const calldata = buildExecutorCalldata(arb, { safetyBps: 50n });
    const a1p1 = BigInt('0x' + sliceBytes(calldata, 72, 32));
    expect(a1p1).toBe(arb.intermediateOut - (arb.intermediateOut * 50n) / 10_000n);
  });
});

describe('buildBundlePayload + RPC envelopes', () => {
  test('wraps txs and serializes blockNumber as hex', () => {
    const tx: Hex = '0xabcdef';
    const bundle = buildBundlePayload([tx], 1_234_567n);
    expect(bundle.txs).toEqual([tx]);
    expect(bundle.blockNumber).toBe('0x12d687');
  });

  test('toJsonRpcRequest builds an eth_sendBundle envelope', () => {
    const tx: Hex = '0xdead';
    const bundle = buildBundlePayload([tx], 100n);
    const req = toJsonRpcRequest(bundle);
    expect(req.method).toBe('eth_sendBundle');
    expect(req.params).toEqual([bundle]);
    expect(req.jsonrpc).toBe('2.0');
  });

  test('toCallBundleRequest tags the simulation block', () => {
    const tx: Hex = '0xdead';
    const bundle = buildBundlePayload([tx], 100n);
    const req = toCallBundleRequest(bundle, 99n);
    expect(req.method).toBe('eth_callBundle');
    expect(req.params[0].stateBlockNumber).toBe('0x63');
    expect(req.params[0].txs).toEqual([tx]);
  });
});
