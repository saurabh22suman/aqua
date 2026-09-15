import type { PgBoss } from "pg-boss";

// PR3 (ops console improvements) — platform.metrics-snapshot. Unlike
// every other schedule in this codebase, this one is NOT per-tenant:
// there is exactly one schedule, registered once, with no `key` and
// no tenant timezone (see worker/index.ts for why this job is a
// deliberate, singular exception to "every job is per-tenant").
//
// 22:00 UTC ≈ 03:30 IST — after the per-tenant reports.rollup jobs
// (which run at 03:00 in each tenant's own local time) have had a
// chance to finish, so "no activity" health signals reflect the
// freshest rollup data available. Exact precision doesn't matter for
// a once-daily platform-wide count.
export const PLATFORM_METRICS_SNAPSHOT_QUEUE = "platform.metrics-snapshot";
const PLATFORM_METRICS_SNAPSHOT_CRON = "0 22 * * *";

export async function schedulePlatformMetricsSnapshot(boss: PgBoss): Promise<void> {
  await boss.schedule(
    PLATFORM_METRICS_SNAPSHOT_QUEUE,
    PLATFORM_METRICS_SNAPSHOT_CRON,
    {},
    { tz: "UTC" },
  );
}
