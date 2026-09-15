import type { PgBoss } from "pg-boss";

// C-47 — the reports.rollup schedule: nightly at 03:00 in the
// tenant's own timezone (architecture §9), after expiry and
// generation so the day's figures are complete when they are frozen.
export const REPORTS_ROLLUP_QUEUE = "reports.rollup";
const REPORTS_ROLLUP_CRON = "0 3 * * *";

export async function scheduleReportsRollup(
  boss: PgBoss,
  tenantId: string,
  timezone: string,
): Promise<void> {
  await boss.schedule(
    REPORTS_ROLLUP_QUEUE,
    REPORTS_ROLLUP_CRON,
    { tenantId },
    { tz: timezone, key: tenantId },
  );
}
