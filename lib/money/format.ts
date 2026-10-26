// en-IN display formatting and its exact inverse. The paise -> rupees
// division below is a TERMINAL step for display only — its result is
// never fed back into further money arithmetic (see arithmetic.ts,
// which stays on integer/BigInt paise throughout). parsePaise reverses
// the string with integer parsing, never parseFloat, so a round trip
// through format-then-parse cannot drift.
//
// "Tabular numerals" (C-28) is a font-rendering property, not a string
// one — this module produces a plain formatted string; wherever it's
// rendered, the UI is responsible for `font-variant-numeric:
// tabular-nums` (or the Tailwind `tabular-nums` utility) so digits
// don't shift width as they change.

const RUPEE_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(paise: number | bigint): string {
  if ((typeof paise === "number" && !Number.isSafeInteger(paise)) || paise < 0) {
    throw new Error(`formatINR expects a non-negative integer paise value, got ${paise}`);
  }
  const exact = BigInt(paise);
  return RUPEE_FORMATTER.formatToParts(exact / 100n).map(part =>
    part.type === "fraction" ? String(exact % 100n).padStart(2, "0") : part.value).join("");
}

// Display-only companion to formatINR for summary figures where paise
// are immaterial (DESIGN.md §4: "no decimals unless paise are
// meaningful"). It trims the exact string formatINR produced from the
// same bigint paise — no extra arithmetic, so a value with real paise
// still shows them and grouping stays en-IN.
export function formatINRCompact(paise: number | bigint): string {
  const exact = formatINR(paise);
  return exact.endsWith(".00") ? exact.slice(0, -3) : exact;
}

export function parsePaise(formatted: string): number {
  // Strip the currency symbol/label and any whitespace Intl may have
  // inserted (some ICU data emits a non-breaking space after ₹).
  const cleaned = formatted.replace(/[₹\s]/g, "").replace(/,/g, "");
  const match = /^(\d+)\.(\d{2})$/.exec(cleaned);
  if (!match) {
    throw new Error(
      `parsePaise expects a value with exactly two fractional digits, got "${formatted}"`,
    );
  }
  const [, rupees, paise] = match;
  const exact = BigInt(rupees) * 100n + BigInt(paise);
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Paise amount is outside the exact integer range.");
  return Number(exact);
}
