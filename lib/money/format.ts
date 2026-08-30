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

// The one deliberate exception to "money is bigint paise, never a
// float" (docs/implementation-plan.md, Standing rules) in this whole
// module. Display only: the Number this produces is handed straight
// to Intl.NumberFormat (which requires a Number, not a bigint, and
// has no integer-cents mode) and returned as a string -- it never
// goes back into arithmetic.ts or anywhere else money is computed.
// This is the ONLY place that conversion may happen; guarded by
// tests/money.test.ts's "no paise-to-Number conversion outside
// formatINR" check, not just this comment.
export function formatINR(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) {
    throw new Error(`formatINR expects a non-negative integer paise value, got ${paise}`);
  }
  return RUPEE_FORMATTER.format(paise / 100);
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
  return Number(rupees) * 100 + Number(paise);
}
