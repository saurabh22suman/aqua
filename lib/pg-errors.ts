// Shared Postgres error classification. drizzle wraps driver errors in
// a DrizzleQueryError, so the Postgres error (with its `code`) is on
// `.cause`; walk the chain instead of checking only the top level.

export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ((err as { code?: unknown }).code === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  return cause !== undefined && cause !== null && cause !== err
    ? isUniqueViolation(cause)
    : false;
}
