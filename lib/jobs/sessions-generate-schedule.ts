import type { PgBoss } from "pg-boss";

// Single source of truth for the sessions.generate schedule shape —
// db/deploy.ts's bulk sync (every trial/active tenant, at deploy time)
// and db/platform-tenant-create.ts's single-tenant registration (one
// tenant, at creation time) both call scheduleSessionsGenerate rather
// than each hand-writing their own boss.schedule() call, so the cron
// string and queue name can't drift between the two call sites.
export const SESSIONS_GENERATE_QUEUE = "sessions.generate";
const SESSIONS_GENERATE_CRON = "0 2 * * *";

export async function scheduleSessionsGenerate(
  boss: PgBoss,
  tenantId: string,
  timezone: string,
): Promise<void> {
  await boss.schedule(
    SESSIONS_GENERATE_QUEUE,
    SESSIONS_GENERATE_CRON,
    { tenantId },
    { tz: timezone, key: tenantId },
  );
}
