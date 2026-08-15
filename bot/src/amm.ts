// Uniswap V2 constant-product math and the closed-form optimal-input
// solver for two-hop cross-DEX arbitrage. All arithmetic is BigInt — uint256
// reserves can exceed Number.MAX_SAFE_INTEGER, and the optimal-input
// formula involves a four-factor product under a square root.

const FEE_NUM = 997n;
const FEE_DEN = 1_000n;

/// Integer floor sqrt via Newton's method. Defined for n ≥ 0.
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('isqrt: negative input');
  if (n < 2n) return n;
  let x = n;
  let y = (n + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (y + n / y) / 2n;
  }
  return x;
}

/// Uniswap V2 swap output for `amountIn` of the input token, given pool
/// reserves. Applies the 0.3% fee (997/1000). Returns 0 for any malformed
/// input — callers should bail before trying to execute.
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * FEE_NUM;
  return (amountInWithFee * reserveOut) / (reserveIn * FEE_DEN + amountInWithFee);
}

export type PoolReserves = {
  /// Reserve of the token we deposit into this pool.
  reserveIn: bigint;
  /// Reserve of the token we withdraw from this pool.
  reserveOut: bigint;
};

/// Optimal input for a two-hop cross-DEX arbitrage in token A.
///
/// Setup: token A → token B on pool 1, token B → token A on pool 2. Hand
/// pool 1 some amount `x` of A; receive `y = getAmountOut(x, R1in, R1out)`
/// of B. Hand pool 2 the `y` of B; receive `z = getAmountOut(y, R2in, R2out)`
/// of A. Profit is `z − x`. We want the `x` that maximizes that.
///
/// Derivation (sketch): substituting yields
///
///     z(x) = r² · R1out · R2out · x / (R1in · R2in + r · x · (R2in + r · R1out))
///
/// where r = 0.997. The Jacobian collapses cleanly:
///
///     dz/dx = r² · R1in · R1out · R2in · R2out / D(x)²
///
/// so setting d(z − x)/dx = 0 gives D(x) = r · √K with K = R1in·R1out·R2in·R2out:
///
///     x* = (r · √K − R1in · R2in) / (r · (R2in + r · R1out))
///
/// Multiplying numerator and denominator by FEE_DEN² and factoring keeps
/// everything in integer arithmetic. If the numerator term is non-positive,
/// the two pools are within fee tolerance — no profitable arb exists and we
/// return 0. Callers (the scanner) should try both pool orderings; this
/// function only solves one direction.
export function getOptimalInput(pool1: PoolReserves, pool2: PoolReserves): bigint {
  const { reserveIn: R1in, reserveOut: R1out } = pool1;
  const { reserveIn: R2in, reserveOut: R2out } = pool2;

  if (R1in <= 0n || R1out <= 0n || R2in <= 0n || R2out <= 0n) return 0n;

  const sqrtK = isqrt(R1in * R1out * R2in * R2out);
  const numTerm = FEE_NUM * sqrtK - FEE_DEN * R1in * R2in;
  if (numTerm <= 0n) return 0n;

  const numerator = FEE_DEN * numTerm;
  const denominator = FEE_NUM * (FEE_DEN * R2in + FEE_NUM * R1out);
  return numerator / denominator;
}

/// Round-trip output through both pools for an arbitrary input.
export function quoteRoundTrip(amountIn: bigint, pool1: PoolReserves, pool2: PoolReserves): bigint {
  const hop1 = getAmountOut(amountIn, pool1.reserveIn, pool1.reserveOut);
  return getAmountOut(hop1, pool2.reserveIn, pool2.reserveOut);
}

export type ArbQuote = {
  amountIn: bigint;
  expectedOut: bigint;
  profit: bigint;
};

/// Compute the optimal arb quote — sizing, expected output, and realized
/// profit. `profit` is 0 when no profitable opportunity exists.
export function quoteOptimalArb(pool1: PoolReserves, pool2: PoolReserves): ArbQuote {
  const amountIn = getOptimalInput(pool1, pool2);
  const expectedOut = quoteRoundTrip(amountIn, pool1, pool2);
  const profit = expectedOut > amountIn ? expectedOut - amountIn : 0n;
  return { amountIn, expectedOut, profit };
}
