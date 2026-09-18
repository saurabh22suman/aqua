import type { PgBoss } from "pg-boss";

// E-06 — the events.rollup schedule: nightly at 03:15 in the tenant's
// own timezone (architecture §9), fifteen minutes after reports.rollup
// (03:00) so it fills in the event columns of the same daily_rollups
// row once that day's operational counters are frozen.
export const EVENTS_ROLLUP_QUEUE = "events.rollup";
const EVENTS_ROLLUP_CRON = "15 3 * * *";

export async function scheduleEventsRollup(
  boss: PgBoss,
  tenantId: string,
  timezone: string,
): Promise<void> {
  await boss.schedule(
    EVENTS_ROLLUP_QUEUE,
    EVENTS_ROLLUP_CRON,
    { tenantId },
    { tz: timezone, key: tenantId },
  );
}
