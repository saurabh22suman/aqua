// Existing action/view contracts use numbers. Crossing that boundary is
// allowed only when the exact bigint amount is safely representable.
export function toSafePaise(value: bigint | string | number): number {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError("Paise amount is outside the exact integer range.");
  }
  const exact = BigInt(value);
  if (exact > BigInt(Number.MAX_SAFE_INTEGER) || exact < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("Paise amount is outside the exact integer range.");
  }
  return Number(exact);
}

export function sumPaise(values: Iterable<number | bigint>): number {
  let total = 0n;
  for (const value of values) {
    if (typeof value === "number") toSafePaise(value);
    total += BigInt(value);
  }
  return toSafePaise(total);
}
