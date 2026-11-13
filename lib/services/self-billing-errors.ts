// Database drivers may wrap SQLSTATE in `cause`. Do not expose SQL or values.
export function isBillingDeadlock(error: unknown): boolean {
  const seen = new Set<unknown>(); let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current); const item = current as { code?: unknown; cause?: unknown };
    if (item.code === "40P01") return true;
    current = item.cause;
  }
  return false;
}
