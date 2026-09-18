import type { PgBoss } from "pg-boss";

// E-06 — the activity.export schedule: nightly at 03:30 in the
// tenant's own timezone, after reports.rollup (03:00) and events.rollup
// (03:15) and before the audit checkpoint (04:00). The exported day is
// the tenant-local day that just ended.
export const ACTIVITY_EXPORT_QUEUE = "activity.export";
const ACTIVITY_EXPORT_CRON = "30 3 * * *";

export async function scheduleActivityExport(
  boss: PgBoss,
  tenantId: string,
  timezone: string,
): Promise<void> {
  await boss.schedule(
    ACTIVITY_EXPORT_QUEUE,
    ACTIVITY_EXPORT_CRON,
    { tenantId },
    { tz: timezone, key: tenantId },
  );
}
