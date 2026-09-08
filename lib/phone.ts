// E.164 phone normalisation for identity rows (`users.phone`).
//
// Canonical form: `+` followed by 8-15 digits (the E.164 form).
// Indian-default helper: a 10-digit local number is treated as
// India (+91) and prefixed; `91XXXXXXXXXX` is treated as `+91`-
// style with the prefix missing.
//
// Why this exists:
//   The seed (`scripts/seed.ts`, `scripts/seed-demo.ts`) stores
//   users.phone as `+919000000001`. better-auth's phone plugin
//   normalises incoming phones by *stripping* the leading `+`, so
//   the `phoneNumber` argument in `callbackOnVerification` arrives
//   as `919000000001`. Without canonicalisation at the write path
//   (`db/platform.ts:linkBetterAuthUser`), every fresh login
//   inserts a second `users` row whose phone differs from the
//   seed's by exactly the leading `+`, the unique constraint is
//   not tripped, and the existing membership lookup (`where
//   phone = ...`) misses both rows.
//
// Why India-default: the seed (and the runbook per
// `docs/demo-runbook.md`) ship Indian test numbers only. A
// production deployment in another country would configure a
// different default — extending this helper with a country-code
// hint is left to the rollout that introduces non-IN phone
// numbers.
//
// Output is always a string. Inputs that don't match a known
// shape pass through (validated shape) — callers handle invalid
// shape via their own Zod schemas.

/**
 * Normalise a phone number to E.164 canonical form. Returns the
 * input unchanged when shape doesn't match a recognised variant;
 * callers gate the shape via zod before passing it here, so a
 * passthrough here means the input was already in an unexpected
 * shape the caller must surface.
 */
export function normaliseToE164(raw: string): string {
  const trimmed = raw.replace(/[\s\-()]/g, "");
  if (trimmed.startsWith("+")) return trimmed;
  // 91XXXXXXXXXX → +91XXXXXXXXXX (12 digits, India with country code)
  if (/^91\d{10}$/.test(trimmed)) return `+${trimmed}`;
  // 0XXXXXXXXXX (leading 0, 11 digits) → strip 0 → +91XXXXXXXXXX
  if (/^0\d{10}$/.test(trimmed)) return `+91${trimmed.slice(1)}`;
  // 10 digits local Indian → +91XXXXXXXXXX
  if (/^\d{10}$/.test(trimmed)) return `+91${trimmed}`;
  // Unknown shape. Surface as-is; callers Zod-check upstream.
  return trimmed;
}

/**
 * Stripped-of-form phone used for matching across E.164 variants:
 * `+919000000001` and `919000000001` both produce `919000000001`.
 * Use this for SELECTs that need to find a row regardless of
 * historical canonical-vs-better-auth write drift; for fresh
 * writes, prefer `normaliseToE164` so the canonical row lands
 * in one place.
 */
export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}
