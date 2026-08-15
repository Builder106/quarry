import { describe, expect, test } from 'bun:test';
import { parseTransaction, type Address, type Hex } from 'viem';
import { accountAddress, signExecutorTx, type ChainFees } from '../src/sign';

// Anvil's first default private key — published and well-known; never use
// for real funds. The corresponding address is the canonical test address
// used across every EVM toolchain.
const ANVIL_KEY_0: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDR_0: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const EXECUTOR: Address = '0x1111111111111111111111111111111111111111';
const SAMPLE_CALLDATA: Hex = '0xdeadbeefcafebabe';

const FEES: ChainFees = {
  chainId: 1,
  nonce: 7,
  gas: 200_000n,
  maxFeePerGas: 30n * 10n ** 9n,
  maxPriorityFeePerGas: 2n * 10n ** 9n,
};

describe('accountAddress', () => {
  test('recovers the canonical Anvil address from its private key', () => {
    expect(accountAddress(ANVIL_KEY_0)).toBe(ANVIL_ADDR_0);
  });
});

describe('signExecutorTx', () => {
  test('produces a parseable EIP-1559 raw tx with the right fields', async () => {
    const raw = await signExecutorTx(ANVIL_KEY_0, EXECUTOR, SAMPLE_CALLDATA, FEES);
    const parsed = parseTransaction(raw);
    expect(parsed.type).toBe('eip1559');
    expect(parsed.to).toBe(EXECUTOR);
    expect(parsed.data).toBe(SAMPLE_CALLDATA);
    // viem omits `value` from parseTransaction output when it's 0n
    // (the default). Treat undefined as zero for this assertion.
    expect(parsed.value ?? 0n).toBe(0n);
    expect(parsed.nonce).toBe(FEES.nonce);
    expect(parsed.gas).toBe(FEES.gas);
    expect(parsed.chainId).toBe(FEES.chainId);
    expect(parsed.maxFeePerGas).toBe(FEES.maxFeePerGas);
    expect(parsed.maxPriorityFeePerGas).toBe(FEES.maxPriorityFeePerGas);
  });

  test('is deterministic for identical inputs', async () => {
    const a = await signExecutorTx(ANVIL_KEY_0, EXECUTOR, SAMPLE_CALLDATA, FEES);
    const b = await signExecutorTx(ANVIL_KEY_0, EXECUTOR, SAMPLE_CALLDATA, FEES);
    expect(a).toBe(b);
  });

  test('changing the nonce changes the signature', async () => {
    const a = await signExecutorTx(ANVIL_KEY_0, EXECUTOR, SAMPLE_CALLDATA, FEES);
    const b = await signExecutorTx(ANVIL_KEY_0, EXECUTOR, SAMPLE_CALLDATA, {
      ...FEES,
      nonce: FEES.nonce + 1,
    });
    expect(a).not.toBe(b);
  });
});
