// EIP-1559 transaction signing for executor calls. Uses viem's local
// account so the private key never leaves the process and no RPC is
// needed for the signing step itself. Nonce + fee data come from outside
// — the caller fetches them at the right moment, typically just before
// constructing the bundle, since both change with every block.

import type { Address, Hex, PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export type ChainFees = {
  chainId: number;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

/// Sign an EIP-1559 transaction calling `executor` with `calldata`. Returns
/// the raw serialized hex ready for inclusion in a Flashbots bundle's
/// `txs[]` array.
export async function signExecutorTx(
  privateKey: Hex,
  executor: Address,
  calldata: Hex,
  fees: ChainFees,
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signTransaction({
    to: executor,
    data: calldata,
    value: 0n,
    gas: fees.gas,
    nonce: fees.nonce,
    chainId: fees.chainId,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    type: 'eip1559',
  });
}

/// Fetch the current nonce + fee parameters for a given account, suitable
/// for signing the next outgoing tx. `priorityFeeWei` defaults to 1 gwei —
/// the Flashbots flow typically pays the builder via the executor's
/// coinbase-transfer, so the priority fee is just a tip floor.
export async function fetchChainFees(
  client: PublicClient,
  account: Address,
  chainId: number,
  gas: bigint = 250_000n,
  priorityFeeWei: bigint = 10n ** 9n,
): Promise<ChainFees> {
  const [nonce, baseFee] = await Promise.all([
    client.getTransactionCount({ address: account }),
    client.getGasPrice(),
  ]);
  return {
    chainId,
    nonce,
    gas,
    // maxFeePerGas covers base fee + priority. 2× baseFee gives one block
    // of headroom for base fee swings.
    maxFeePerGas: baseFee * 2n + priorityFeeWei,
    maxPriorityFeePerGas: priorityFeeWei,
  };
}

/// Recover the address from a private key without signing anything — used
/// by the demo runner to fund / approve the bot's address before assembling
/// the bundle.
export function accountAddress(privateKey: Hex): Address {
  return privateKeyToAccount(privateKey).address;
}
