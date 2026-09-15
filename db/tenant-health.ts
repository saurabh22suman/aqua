import { sql } from "drizzle-orm";
import { tenants } from "./schema/tenants";

// PR2 (ops console improvements) — one computation, reused by the
// tenants list column, the Overview KPI cards and the needs-attention
// queue (the latter two land in a later PR; this module is written so
// they consume the exact same signals rather than re-deriving them).
//
// The join below is meant to be spliced into an existing per-tenant
// SELECT (see db/platform-tenants.ts::listTenants) so cross-tenant
// health never costs a second round trip or a per-tenant fan-out —
// it is four LEFT JOIN subqueries, each already grouped by tenant_id,
// joined once onto whatever tenant rows the caller is already
// fetching. tests/tenant-health-query-shape.test.ts pins the query
// count at a fixed number regardless of tenant count.
//
// Health is not computed for 'churned' tenants — churned is terminal;
// showing a health pill next to it implies work to do, and there
// isn't any.

export const TENANT_HEALTH_JOINS = sql`
  left join (
    select tenant_id, max(current_date - due_on) as max_overdue_days
    from invoices
    where status in ('issued', 'partial') and due_on < current_date
    group by tenant_id
  ) health_overdue on health_overdue.tenant_id = ${tenants.id}
  left join (
    select tenant_id, max(on_date) as last_active_on
    from daily_rollups
    where sessions_held > 0 or attendance_marked > 0
    group by tenant_id
  ) health_activity on health_activity.tenant_id = ${tenants.id}
  left join (
    select tenant_id, count(*)::int as failed_7d
    from message_log
    where status = 'failed' and created_at >= now() - interval '7 days'
    group by tenant_id
  ) health_failed_msgs on health_failed_msgs.tenant_id = ${tenants.id}
  left join (
    select tenant_id, min(created_at) as oldest_pending_at
    from config_change_requests
    where status = 'requested'
    group by tenant_id
  ) health_pending_cr on health_pending_cr.tenant_id = ${tenants.id}
`;

export const TENANT_HEALTH_COLUMNS = sql`
  health_overdue.max_overdue_days     as "healthMaxOverdueDays",
  health_activity.last_active_on      as "healthLastActiveOn",
  coalesce(health_failed_msgs.failed_7d, 0) as "healthFailed7d",
  health_pending_cr.oldest_pending_at  as "healthOldestPendingAt"
`;

export type TenantHealthStatus = "healthy" | "attention" | "at_risk";

export type TenantHealthRawRow = {
  healthMaxOverdueDays: number | null;
  healthLastActiveOn: string | null;
  healthFailed7d: number | string;
  healthOldestPendingAt: string | null;
};

export type TenantHealthInput = {
  tenantStatus: "trial" | "active" | "suspended" | "churned";
  createdAt: Date;
  memberCount: number;
  trialExpiresAt: Date | null;
  maxOverdueDays: number | null;
  lastActiveOn: Date | null;
  failed7d: number;
  oldestPendingAt: Date | null;
  now?: Date;
};

// PR3 (ops console improvements) — the needs-attention queue needs a
// per-issue severity and age, not just a formatted string. Built from
// the exact same branches as `reasons` (see classifyTenantHealth) so
// the queue and the health pill can never drift apart from each other
// — `reasons` is `details.map(d => d.text)`, kept for PR2 compatibility.
export type TenantHealthDetail = {
  text: string;
  severity: "attention" | "at_risk";
  ageDays: number | null;
};

export type TenantHealthResult = {
  // null = not scored (churned tenants).
  status: TenantHealthStatus | null;
  reasons: string[];
  details: TenantHealthDetail[];
};

// Thresholds are the whole rule. Each is the only place the value
// is set; tests/tenant-health.test.ts pins every constant so a
// change is deliberate. docs/project-scope.md names the constants
// and points here — do NOT restate the numbers in the doc, a
// duplicated number drifts.
export const NO_ACTIVITY_ATTENTION_DAYS = 14;
/** Invoice overdue beyond this is at_risk; at or under is attention. */
export const OVERDUE_AT_RISK_DAYS = 14;
/** Trial expiring within this many days surfaces attention; expired surfaces at_risk. */
export const TRIAL_ATTENTION_DAYS = 7;
/** Weekly failed-message count above which attention fires; 0..2 silent. */
export const FAILED_MESSAGE_ATTENTION_THRESHOLD = 3;
/** A pending change request older than this surfaces attention. */
export const PENDING_REQUEST_ATTENTION_DAYS = 3;

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor(
    (later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000),
  );
}

export function classifyTenantHealth(
  input: TenantHealthInput,
): TenantHealthResult {
  if (input.tenantStatus === "churned") {
    return { status: null, reasons: [], details: [] };
  }

  const now = input.now ?? new Date();
  const details: TenantHealthDetail[] = [];

  if (input.memberCount === 0) {
    details.push({ text: "Zero members", severity: "at_risk", ageDays: null });
  }

  if (input.maxOverdueDays != null) {
    const severity: TenantHealthDetail["severity"] =
      input.maxOverdueDays > OVERDUE_AT_RISK_DAYS ? "at_risk" : "attention";
    details.push({
      text: `Invoice overdue ${input.maxOverdueDays}d`,
      severity,
      ageDays: input.maxOverdueDays,
    });
  }

  if (input.tenantStatus === "trial" && input.trialExpiresAt) {
    const daysLeft = daysBetween(input.trialExpiresAt, now);
    if (daysLeft < 0) {
      details.push({
        text: "Trial expired",
        severity: "at_risk",
        ageDays: -daysLeft,
      });
    } else if (daysLeft <= TRIAL_ATTENTION_DAYS) {
      details.push({
        text: `Trial expires in ${daysLeft}d`,
        severity: "attention",
        ageDays: daysLeft,
      });
    }
  }

  // Suspended tenants are expected to be inactive — that's what
  // suspended means. Flagging it again as "no activity" would be
  // restating the status, not a new finding.
  if (input.tenantStatus !== "suspended") {
    const since = input.lastActiveOn ?? input.createdAt;
    const daysSinceActivity = daysBetween(now, since);
    if (daysSinceActivity > NO_ACTIVITY_ATTENTION_DAYS) {
      details.push({
        text: `No activity in ${daysSinceActivity}d`,
        severity: "attention",
        ageDays: daysSinceActivity,
      });
    }
  }

  if (input.failed7d >= FAILED_MESSAGE_ATTENTION_THRESHOLD) {
    details.push({
      text: `${input.failed7d} failed messages this week`,
      severity: "attention",
      ageDays: null,
    });
  }

  if (input.oldestPendingAt) {
    const pendingDays = daysBetween(now, input.oldestPendingAt);
    if (pendingDays >= PENDING_REQUEST_ATTENTION_DAYS) {
      details.push({
        text: `Change request pending ${pendingDays}d`,
        severity: "attention",
        ageDays: pendingDays,
      });
    }
  }

  const reasons = details.map((d) => d.text);
  if (details.some((d) => d.severity === "at_risk")) {
    return { status: "at_risk", reasons, details };
  }
  if (details.length > 0) {
    return { status: "attention", reasons, details };
  }
  return { status: "healthy", reasons: [], details: [] };
}
