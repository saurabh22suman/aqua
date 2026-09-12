import { notFound } from "next/navigation";

// P0-1 (mobile UX audit, 2026-09-12) — dynamic URL segments reach
// server actions that Zod-parse them as UUIDs. A malformed segment
// ("INVALID-ID", or a human-typed member code like "AWS-010") threw a
// raw ZodError: Next's dev overlay leaked the pattern and stack, and
// production (no error.tsx) fell through to the default error page.
//
// The pages call this immediately after `await params` and before any
// action or DB call, so a bad segment becomes the same friendly 404
// as a well-formed id that doesn't exist. The check mirrors Zod's
// `z.string().uuid()` shape (versions 1–8, variant 89ab) on purpose:
// it is a routing guard for URL segments, and the action's own parse
// remains the write/read boundary.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function requireUuidParam(value: string): string {
  if (!UUID_RE.test(value)) notFound();
  return value;
}
