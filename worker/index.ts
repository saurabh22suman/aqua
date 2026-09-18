import { createAppScopedBoss } from "@/db/queue";
import { runSessionsGenerateJob } from "@/lib/jobs/sessions-generate-job";
import { runAbsenceAlertsJob } from "@/lib/jobs/absence-alerts-job";
import { runSubscriptionsExpireJob } from "@/lib/jobs/subscriptions-expire-job";
import { runInvoicesGenerateJob } from "@/lib/jobs/invoices-generate-job";
import { runReportsRollupJob } from "@/lib/jobs/reports-rollup-job";
import { runEventsRollupJob } from "@/lib/jobs/events-rollup-job";
import { runPlatformMetricsSnapshotJob } from "@/lib/jobs/platform-metrics-snapshot-job";
import {
  ACTIVITY_INGEST_QUEUE,
  runActivityIngestJob,
  type ActivityIngestJobData,
} from "@/lib/jobs/activity-ingest-job";
import { SESSIONS_GENERATE_QUEUE } from "@/lib/jobs/sessions-generate-schedule";
import { ABSENCE_ALERTS_QUEUE } from "@/lib/jobs/absence-alerts-schedule";
import { SUBSCRIPTIONS_EXPIRE_QUEUE } from "@/lib/jobs/subscriptions-expire-schedule";
import { INVOICES_GENERATE_QUEUE } from "@/lib/jobs/invoices-generate-schedule";
import { REPORTS_ROLLUP_QUEUE } from "@/lib/jobs/reports-rollup-schedule";
import { EVENTS_ROLLUP_QUEUE } from "@/lib/jobs/events-rollup-schedule";
import { PLATFORM_METRICS_SNAPSHOT_QUEUE } from "@/lib/jobs/platform-metrics-snapshot-schedule";
import { asTenantId, type TenantId } from "@/lib/ids";

// Connects as app_user (via db/queue.ts's drizzle-backed adapter) —
// never the privileged migration role. No tenant enumeration happens
// here or anywhere in this process: db/deploy.ts registers one schedule
// per tenant, each carrying its own tenantId (see
// syncPerTenantSchedules), so every job this worker receives already
// knows which tenant it's for. See docs/architecture.md's
// "Cross-tenant job scheduling" section for why — this process must
// never hold the privileged migration connection string (enforced
// mechanically, source-file level, by the no-superuser-on-request-path
// test).
//
// C-47 added the three billing queues; `data.tenantId` is deserialized
// from pg-boss's queue table (an untrusted input boundary, same class
// of cast as a Zod-validated request body) — db/deploy.ts and
// db/platform-tenant-create.ts are the only enqueuers and both always
// write a real tenants.id.
//
// PR3 (ops console improvements) — platform.metrics-snapshot is the
// one cross-tenant job in this process. Every other job in HANDLERS
// (sessions.generate, absence.alerts, subscriptions.expire,
// invoices.generate, reports.rollup, events.rollup) is per-tenant: the worker
// receives a `tenantId` per job from pg-boss and the job opens a
// `withTenant()` transaction. The snapshot carries no tenantId —
// it writes one row per day to `platform_metrics_daily`, an
// aggregate, platform-wide table with no tenant_id. Reads happen
// under `withPlatformAdmin()`, the same cross-tenant-read scope
// every /ops server action already uses; writes happen against the
// allowlisted platform table, which is reachable by any app_user
// connection (no policy gate). It enumerates nothing per-row —
// its reads are COUNTs, not listings. It is registered once,
// globally, not per tenant (see
// lib/jobs/platform-metrics-snapshot-schedule.ts), and handled
// separately below rather than forced into HANDLERS' per-tenant
// shape. tests/tier1/no-superuser-on-request-path.test.ts is the
// mechanical guard that this job's connection is app_user, never
// the migration role.

const HANDLERS: ReadonlyArray<{
  queue: string;
  run: (tenantId: TenantId) => Promise<void>;
}> = [
  { queue: SESSIONS_GENERATE_QUEUE, run: runSessionsGenerateJob },
  { queue: ABSENCE_ALERTS_QUEUE, run: runAbsenceAlertsJob },
  { queue: SUBSCRIPTIONS_EXPIRE_QUEUE, run: runSubscriptionsExpireJob },
  { queue: INVOICES_GENERATE_QUEUE, run: runInvoicesGenerateJob },
  { queue: REPORTS_ROLLUP_QUEUE, run: runReportsRollupJob },
  { queue: EVENTS_ROLLUP_QUEUE, run: runEventsRollupJob },
];

async function main(): Promise<void> {
  const boss = createAppScopedBoss();
  boss.on("error", (err: Error) => console.error("[worker] pg-boss error:", err));

  await boss.start();

  for (const handler of HANDLERS) {
    await boss.work<{ tenantId: string }>(handler.queue, async ([job]) => {
      await handler.run(asTenantId(job.data.tenantId));
    });
  }

  await boss.work(PLATFORM_METRICS_SNAPSHOT_QUEUE, async () => {
    await runPlatformMetricsSnapshotJob();
  });

  // E-05 — activity.ingest is tenant-scoped via job data (same rule as
  // HANDLERS) but carries a per-job `events` payload, so it registers
  // its own work call rather than being forced into HANDLERS' shape.
  // No per-tenant schedule exists for it: it is an event consumer, not
  // a cron (see lib/jobs/activity-ingest-job.ts).
  await boss.work<ActivityIngestJobData>(
    ACTIVITY_INGEST_QUEUE,
    async ([job]) => {
      await runActivityIngestJob(asTenantId(job.data.tenantId), job.data.events);
    },
  );

  console.log(
    `[worker] started — listening on ${[
      ...HANDLERS.map((h) => h.queue),
      PLATFORM_METRICS_SNAPSHOT_QUEUE,
      ACTIVITY_INGEST_QUEUE,
    ].join(", ")}`,
  );
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
