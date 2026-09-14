// GST rate helpers — pure, shared by the ops console and tests. A rate
// is stored in basis points (1800 = 18%); the UI edits it as a
// percentage with at most two decimals. Integer math only.

export const DEFAULT_GST_RATE_BP = 1800;

export function parsePercentToBasisPoints(raw: string): number | null {
  const text = raw.trim().replace(/%/g, "");
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0") || "0";
  const basisPoints = whole * 100 + Number(fraction);
  if (basisPoints < 0 || basisPoints > 10000) return null;
  return basisPoints;
}

export function formatBasisPointsAsPercent(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return `${whole}%`;
  const fractionText = String(fraction).padStart(2, "0").replace(/0$/, "");
  return `${whole}.${fractionText}%`;
}
