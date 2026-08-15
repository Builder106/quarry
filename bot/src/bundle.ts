// Flashbots bundle assembly. Pure-function calldata builder and JSON-RPC
// envelope builder; signing lives in `sign.ts`, submission lives outside
// this module (the relay round trip is V1 of bundle wiring — until then
// we simulate against forked anvil locally).
//
// The 220-byte packed calldata layout matches contracts/src/Executor.yul
// exactly. Any drift between this file and that one is a bug; the layout
// test in bot/test/bundle.test.ts pins the contract.

import { encodeFunctionData, encodePacked, parseAbi, toHex, type Address, type Hex } from 'viem';
import { sortTokens } from './pairs';
import type { ScoredArb } from './score';

/// Mainnet Aave V3 Pool address (the proxy contract). Hardcoded in the Yul
/// executor too — changing this requires a fresh executor deployment.
export const AAVE_V3_POOL: Address = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';

const AAVE_POOL_ABI = parseAbi([
  'function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes params, uint16 referralCode)',
]);

/// Default safety margin in basis points (0.01%) shaved off both leg outputs.
/// Uniswap V2's K-invariant check uses integer arithmetic and is sensitive
/// to floor-division boundaries; asking for the exact `getAmountOut` value
/// reverts with "UniswapV2: K" surprisingly often, especially when the
/// scoring's predicted post-victim reserves differ from chain reserves by
/// a wei or two. Standard MEV bot practice is to request slightly less than
/// the maximum to leave slack. The default 1 bp is small enough that
/// profit barely moves but large enough to absorb any rounding drift.
const DEFAULT_SAFETY_BPS = 1n;
const BPS_DENOMINATOR = 10_000n;

export type CalldataOptions = {
  /// Basis points (1/10,000ths) to shave off each leg's requested output.
  /// 0 disables the margin entirely; the executor will then ask for the
  /// exact `getAmountOut` value, which can revert on K. Default: 1 bp.
  safetyBps?: bigint;
  /// Minimum baseToken profit the executor will accept before reverting.
  /// 0 means "any positive profit." In production, set this above the
  /// expected MEV competition floor so the bundle bails if a faster
  /// searcher partially fills first.
  minProfit?: bigint;
};

/// Build the 220-byte packed calldata for the V2 Quarry executor.
///
/// Layout (from Executor.yul):
///   bytes   0..20  : address pool1     (= victimPair, where leg 1 trades)
///   bytes  20..40  : address pool2     (= arbPair, where leg 2 trades)
///   bytes  40..72  : uint256 amount0OutP1
///   bytes  72..104 : uint256 amount1OutP1
///   bytes 104..136 : uint256 amount0OutP2
///   bytes 136..168 : uint256 amount1OutP2
///   bytes 168..188 : address tokenIn   (= baseToken, the profit measurer)
///   bytes 188..220 : uint256 minProfit
///
/// Total: 220 bytes. The executor reads each field with calldataload and
/// shr where addresses sit in the high-20-bytes of a 32-byte word.
export function buildExecutorCalldata(arb: ScoredArb, options: CalldataOptions = {}): Hex {
  const safetyBps = options.safetyBps ?? DEFAULT_SAFETY_BPS;
  const minProfit = options.minProfit ?? 0n;

  // Shave the safety margin off both leg outputs. The scored profit
  // shrinks by ~2× safetyBps as a result.
  const shave = (x: bigint): bigint => x - (x * safetyBps) / BPS_DENOMINATOR;
  const intermediateOut = shave(arb.intermediateOut);
  const expectedOut = shave(arb.expectedOut);

  // Uniswap V2 convention: token0 has the lower address. Both pools share
  // the same ordering for a given (baseToken, intermediateToken) pair, so
  // one comparison fixes the amount-slot layout for both legs.
  const [token0] = sortTokens(arb.baseToken, arb.intermediateToken);
  const intermediateIsToken0 = BigInt(arb.intermediateToken) === BigInt(token0);

  // Leg 1: pool1 sends `intermediateOut` of intermediateToken to pool2.
  // Whichever amount slot corresponds to intermediateToken carries the value.
  const amount0OutP1 = intermediateIsToken0 ? intermediateOut : 0n;
  const amount1OutP1 = intermediateIsToken0 ? 0n : intermediateOut;

  // Leg 2: pool2 sends `expectedOut` of baseToken to the executor.
  // Whichever amount slot corresponds to baseToken carries the value.
  const amount0OutP2 = intermediateIsToken0 ? 0n : expectedOut;
  const amount1OutP2 = intermediateIsToken0 ? expectedOut : 0n;

  return encodePacked(
    ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'address', 'uint256'],
    [
      arb.victimPair,
      arb.arbPair,
      amount0OutP1,
      amount1OutP1,
      amount0OutP2,
      amount1OutP2,
      arb.baseToken,
      minProfit,
    ]
  );
}

/// Flashbots eth_sendBundle envelope. `txs` is an ordered array of raw
/// signed transactions (hex). `blockNumber` is the target block as hex.
/// Optional timestamp bounds gate inclusion to a specific window.
export type FlashbotsBundle = {
  txs: readonly Hex[];
  blockNumber: Hex;
  minTimestamp?: number;
  maxTimestamp?: number;
};

/// Wrap one or more signed transactions in the Flashbots envelope for a
/// specific target block. Caller provides the txs already serialized.
export function buildBundlePayload(
  signedTxs: readonly Hex[],
  targetBlock: bigint
): FlashbotsBundle {
  return { txs: signedTxs, blockNumber: toHex(targetBlock) };
}

/// Convenience: pack a `FlashbotsBundle` into the JSON-RPC request body
/// the Flashbots relay expects.
export function toJsonRpcRequest(bundle: FlashbotsBundle): {
  jsonrpc: '2.0';
  id: number;
  method: 'eth_sendBundle';
  params: readonly [FlashbotsBundle];
} {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendBundle',
    params: [bundle],
  };
}

/// Convenience for simulation: the Flashbots `eth_callBundle` envelope.
/// Same shape plus `stateBlockNumber` (the block to simulate against).
export function toCallBundleRequest(
  bundle: FlashbotsBundle,
  stateBlock: bigint
): {
  jsonrpc: '2.0';
  id: number;
  method: 'eth_callBundle';
  params: readonly [FlashbotsBundle & { stateBlockNumber: Hex }];
} {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_callBundle',
    params: [{ ...bundle, stateBlockNumber: toHex(stateBlock) }],
  };
}

/// A bot transaction's destination + calldata. Either calls the executor
/// directly (legacy V2 path — bot must pre-fund the victim pair) or wraps
/// the executor call in Aave V3's flashLoanSimple (V3 path — bot needs no
/// inventory; Aave provides the asset and is repaid + premium atomically).
export type ExecutionCall = {
  to: Address;
  data: Hex;
};

/// Build the bot's outgoing transaction for the V3 flashloan path. The
/// bot sends this to Aave V3's pool; Aave handles the asset transfer to
/// the executor and the callback. `executor` is the deployed Yul contract;
/// `arb` is the scored opportunity; `options` flow through to
/// `buildExecutorCalldata` (safetyBps, minProfit).
export function buildFlashloanCall(
  arb: ScoredArb,
  executor: Address,
  options: CalldataOptions = {}
): ExecutionCall {
  const params = buildExecutorCalldata(arb, options);
  const data = encodeFunctionData({
    abi: AAVE_POOL_ABI,
    functionName: 'flashLoanSimple',
    args: [executor, arb.baseToken, arb.amountIn, params, 0],
  });
  return { to: AAVE_V3_POOL, data };
}

/// Build the bot's outgoing transaction for the V2 legacy path — direct
/// call to the executor. Caller must arrange for the executor to have the
/// arb's `amountIn` of `baseToken` available at the victim pair before
/// this transaction lands (typically via a flashloan in bundle position 0,
/// or by inventorying the asset).
export function buildDirectCall(
  arb: ScoredArb,
  executor: Address,
  options: CalldataOptions = {}
): ExecutionCall {
  return { to: executor, data: buildExecutorCalldata(arb, options) };
}

/// Address that builds use to identify our executor on-chain. Not strictly
/// required for bundle building — the signed tx already has `to` — but
/// exported for callers that want to log/verify against a deployed address.
export const EXECUTOR_ADDRESS_ENV = 'EXECUTOR_ADDRESS';

export function getExecutorAddress(): Address {
  const env = process.env[EXECUTOR_ADDRESS_ENV];
  if (!env || !/^0x[0-9a-fA-F]{40}$/.test(env)) {
    throw new Error(
      `${EXECUTOR_ADDRESS_ENV} must be set to a 20-byte hex address (e.g. from a forked anvil deploy)`
    );
  }
  return env as Address;
}
