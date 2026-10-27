/**
 * The audit instant.
 *
 * The audit table is range-partitioned by created_at with a static
 * horizon that starts at 2026-01 (db/migrations/20260918090000_h03_*).
 * A row older than that has no partition and the insert fails loudly,
 * so a backdated audit instant is clamped to the horizon — and never
 * past the run's own clock, because an audit row dated in the future is
 * as untrue as a payment dated in the future.
 */
const AUDIT_HORIZON_START = Date.parse("2026-01-01T00:00:00.000Z");

export function auditInstant(iso: string, nowMs: number): Date {
  return new Date(
    Math.min(Math.max(Date.parse(iso), AUDIT_HORIZON_START), nowMs),
  );
}
