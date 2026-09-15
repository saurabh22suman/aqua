import type { PgBoss } from "pg-boss";

// C-47 — the subscriptions.expire schedule, same shape as
// sessions.generate: one schedule per tenant, keyed by tenantId, at
// 02:15 in the tenant's own timezone (architecture §9's table).
export const SUBSCRIPTIONS_EXPIRE_QUEUE = "subscriptions.expire";
const SUBSCRIPTIONS_EXPIRE_CRON = "15 2 * * *";

export async function scheduleSubscriptionsExpire(
  boss: PgBoss,
  tenantId: string,
  timezone: string,
): Promise<void> {
  await boss.schedule(
    SUBSCRIPTIONS_EXPIRE_QUEUE,
    SUBSCRIPTIONS_EXPIRE_CRON,
    { tenantId },
    { tz: timezone, key: tenantId },
  );
}
