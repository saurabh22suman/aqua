// All amounts are integer paise (1/100 rupee). Never a float, never a
// Postgres numeric — see docs/architecture.md §8.6. Every computation
// here goes through BigInt for the multiply/divide step so no floating
// point operation is ever performed on money, not even internally.

function assertPaise(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer (paise), got ${value}`);
  }
}

function assertBasisPoints(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`basisPoints must be a non-negative integer, got ${value}`);
  }
}

// Round-half-up on an exact integer ratio via BigInt — the whole
// computation (multiply, add half the denominator, integer-divide)
// never touches a float.
function bigIntRoundedDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function computeTax(basePaise: number, basisPoints: number): number {
  assertPaise(basePaise, "basePaise");
  assertBasisPoints(basisPoints);
  const tax = bigIntRoundedDivide(BigInt(basePaise) * BigInt(basisPoints), 10000n);
  return Number(tax);
}

// The inverse of computeTax: given a GST-inclusive total and the rate,
// recover the base and tax. tax is computed as the REMAINDER
// (total - base), not independently re-derived — this guarantees
// base + tax === total exactly, always, even for totals that aren't
// exactly reachable by some (base, bp) -> total forward computation
// (computeTax rounds, so not every total has an exact forward
// pre-image; splitTotal must still never lose or invent paise).
export function splitTotal(
  totalPaise: number,
  basisPoints: number,
): { base: number; tax: number } {
  assertPaise(totalPaise, "totalPaise");
  assertBasisPoints(basisPoints);
  const base = Number(
    bigIntRoundedDivide(BigInt(totalPaise) * 10000n, 10000n + BigInt(basisPoints)),
  );
  return { base, tax: totalPaise - base };
}

export function applyPayments(
  totalPaise: number,
  payments: number[],
): { paid: number; outstanding: number } {
  assertPaise(totalPaise, "totalPaise");
  let paid = 0n;
  for (const p of payments) {
    assertPaise(p, "payment");
    paid += BigInt(p);
  }
  const outstanding = BigInt(totalPaise) - paid;
  return {
    paid: Number(paid),
    outstanding: outstanding > 0n ? Number(outstanding) : 0,
  };
}
