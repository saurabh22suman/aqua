import type { PgBoss } from "pg-boss";

// R.8 — the absence-alert daily schedule, same shape as
// sessions.generate: one schedule per tenant, keyed by tenantId, at
// 07:00 in the tenant's own timezone (after the overnight session
// generation, before the day's first register).
export const ABSENCE_ALERTS_QUEUE = "alerts.absence";
const ABSENCE_ALERTS_CRON = "0 7 * * *";

export async function scheduleAbsenceAlerts(
  boss: PgBoss,
  tenantId: string,
  timezone: string,
): Promise<void> {
  await boss.schedule(
    ABSENCE_ALERTS_QUEUE,
    ABSENCE_ALERTS_CRON,
    { tenantId },
    { tz: timezone, key: tenantId },
  );
}
