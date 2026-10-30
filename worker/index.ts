import { createAppScopedBoss } from "@/db/queue";
import { recordWorkerHeartbeat } from "@/db/worker-heartbeats";
import { createShutdownHandler } from "@/lib/jobs/worker-shutdown";
import { WORKER_HEARTBEAT_INTERVAL_MS } from "@/lib/health/worker-heartbeat";
import os from "node:os";
import { runSessionsGenerateJob } from "@/lib/jobs/sessions-generate-job";
import { runAbsenceAlertsJob } from "@/lib/jobs/absence-alerts-job";
import { runSubscriptionsExpireJob } from "@/lib/jobs/subscriptions-expire-job";
import { runInvoicesGenerateJob } from "@/lib/jobs/invoices-generate-job";
import { runReportsRollupJob } from "@/lib/jobs/reports-rollup-job";
import { runEventsRollupJob } from "@/lib/jobs/events-rollup-job";
import { runActivityExportJob } from "@/lib/jobs/activity-export-job";
import { runAuditCheckpointJob } from "@/lib/jobs/audit-checkpoint-job";
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
import { ACTIVITY_EXPORT_QUEUE } from "@/lib/jobs/activity-export-schedule";
import { AUDIT_CHECKPOINT_QUEUE } from "@/lib/jobs/audit-checkpoint-schedule";
import { PLATFORM_METRICS_SNAPSHOT_QUEUE } from "@/lib/jobs/platform-metrics-snapshot-schedule";
import { asTenantId, type TenantId } from "@/lib/ids";
import { WHATSAPP_NOTIFICATIONS_QUEUE } from "@/lib/jobs/whatsapp-notifications-schedule";
import { runWhatsAppNotificationsJob } from "@/lib/jobs/whatsapp-notifications-job";

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
// invoices.generate, reports.rollup, events.rollup, activity.export,
// audit.checkpoint) is per-tenant: the worker
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

// F09 (composed, rev 3) — the alert path for a failing job.
//
// pg-boss v12 emits NO per-job failure event: its event map is
// error | warning | wip | stopped | bam | flow (node_modules/pg-boss/
// dist/types.d.ts, PgBossEventMap). A job that throws is retried
// silently, so without this the worker says NOTHING about a job that
// is failing — the only trace is the absence of its usual output.
//
// WHAT THIS LINE MAY CONTAIN — a rule applied by construction, not by
// review:
//   * a code from a CLOSED list of literals;
//   * the queue name, but only after it passes a format check;
//   * the tenant id, but only after it passes a uuid check;
//   * the attempt counters, as bounded integers;
//   * the pg-boss job id, but only after it passes a uuid check.
//
// It NEVER contains the thrown value: not its message, not its stack,
// not its name, not its code, not any property of it. A provider
// exception can carry a recipient's phone number, a request body, an
// authorization header or an API key, and an ordinary log line is the
// least controlled surface in the system. The classification that IS
// safe lives in the audit trail, where it was written deliberately:
// the notification dispatch records no_provider | provider_rejected |
// not_allowed | outcome_unknown. This line only says that the job
// failed.
//
// The code is derived from the SHAPE of the throw — a type test only
// (`instanceof Error` reads no property) — never from its content.
type JobFailureCode = "job_failed" | "job_threw_non_error";

// A queue name is one of our own constants. The check is a guard
// against a future queue name that is derived from data.
const SAFE_QUEUE_RE = /^[a-z][a-z0-9._-]{0,63}$/;
const SAFE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeQueue(value: string): string {
  return SAFE_QUEUE_RE.test(value) ? value : "other";
}

function safeTenantId(value: string | null): string {
  return value && SAFE_UUID_RE.test(value) ? value : "none";
}

function safeJobId(value: string): string {
  return SAFE_UUID_RE.test(value) ? value : "unknown";
}

function safeCount(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : -1;
}

function alertJobFailure(
  queue: string,
  tenantId: string | null,
  job: { id: string; retryCount: number; retryLimit: number },
  err: unknown,
): void {
  const attempt = safeCount(job.retryCount) + 1;
  const total = safeCount(job.retryLimit) + 1;
  const code: JobFailureCode =
    err instanceof Error ? "job_failed" : "job_threw_non_error";
  console.error(
    `[worker] job_failure code=${code} queue=${safeQueue(queue)} ` +
      `tenant=${safeTenantId(tenantId)} job=${safeJobId(job.id)} ` +
      `attempt=${attempt}/${total}${attempt >= total ? " last_attempt" : ""}`,
  );
}

const HANDLERS: ReadonlyArray<{
  queue: string;
  run: (tenantId: TenantId) => Promise<void>;
}> = [
  { queue: WHATSAPP_NOTIFICATIONS_QUEUE, run: runWhatsAppNotificationsJob },
  { queue: SESSIONS_GENERATE_QUEUE, run: runSessionsGenerateJob },
  { queue: ABSENCE_ALERTS_QUEUE, run: runAbsenceAlertsJob },
  { queue: SUBSCRIPTIONS_EXPIRE_QUEUE, run: runSubscriptionsExpireJob },
  { queue: INVOICES_GENERATE_QUEUE, run: runInvoicesGenerateJob },
  { queue: REPORTS_ROLLUP_QUEUE, run: runReportsRollupJob },
  { queue: EVENTS_ROLLUP_QUEUE, run: runEventsRollupJob },
  { queue: ACTIVITY_EXPORT_QUEUE, run: runActivityExportJob },
  { queue: AUDIT_CHECKPOINT_QUEUE, run: runAuditCheckpointJob },
];

async function main(): Promise<void> {
  const boss = createAppScopedBoss();
  // A pg-boss error can carry a connection string, a query or a payload,
  // so the raw error object — message and stack included — is NOT logged.
  // A fixed event code is enough to say that the event happened; the
  // cause stays out of an ordinary log line.
  boss.on("error", () => console.error("[worker] worker_event code=pg_boss_error"));

  await boss.start();
  for (const handler of HANDLERS) {
    await boss.work<{ tenantId: string }, unknown, { includeMetadata: true }>(
      handler.queue,
      { includeMetadata: true },
      async ([job]) => {
        try {
          await handler.run(asTenantId(job.data.tenantId));
        } catch (err) {
          alertJobFailure(handler.queue, job.data.tenantId, job, err);
          // Re-thrown unchanged: pg-boss still retries the job and the
          // retry / dead-letter policy stays the queue's, not this
          // handler's.
          throw err;
        }
      },
    );
  }

  await boss.work<unknown, unknown, { includeMetadata: true }>(
    PLATFORM_METRICS_SNAPSHOT_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      try {
        await runPlatformMetricsSnapshotJob();
      } catch (err) {
        // No tenant: this job is the one cross-tenant job in the
        // process (see the note above).
        alertJobFailure(PLATFORM_METRICS_SNAPSHOT_QUEUE, null, job, err);
        throw err;
      }
    },
  );

  // E-05 — activity.ingest is tenant-scoped via job data (same rule as
  // HANDLERS) but carries a per-job `events` payload, so it registers
  // its own work call rather than being forced into HANDLERS' shape.
  // No per-tenant schedule exists for it: it is an event consumer, not
  // a cron (see lib/jobs/activity-ingest-job.ts).
  await boss.work<ActivityIngestJobData, unknown, { includeMetadata: true }>(
    ACTIVITY_INGEST_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      try {
        await runActivityIngestJob(asTenantId(job.data.tenantId), job.data.events);
      } catch (err) {
        alertJobFailure(ACTIVITY_INGEST_QUEUE, job.data.tenantId, job, err);
        throw err;
      }
    },
  );

  console.log(
    `[worker] started — listening on ${[
      ...HANDLERS.map((h) => h.queue),
      PLATFORM_METRICS_SNAPSHOT_QUEUE,
      ACTIVITY_INGEST_QUEUE,
    ].join(", ")}`,
  );

  // PR1-C8 — liveness. The first beat lands before the worker can be
  // declared ready; /api/health turns a stale beat into 503, so a
  // worker that dies (or never started, in production) fails the
  // deploy gate. SIGTERM/SIGINT drain in-flight jobs, clear the
  // interval and exit 0.
  const workerId = `${os.hostname()}-${process.pid}`;
  await recordWorkerHeartbeat(workerId);
  const heartbeat = setInterval(() => {
    // Same rule as the pg-boss listener above: the failure is reported by
    // a fixed code, never by the error object.
    void recordWorkerHeartbeat(workerId).catch(() => {
      console.error("[worker] worker_event code=heartbeat_failed");
    });
  }, WORKER_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  const shutdown = createShutdownHandler({
    stop: () => boss.stop({ graceful: true, timeout: 30_000 }),
    clearHeartbeat: () => clearInterval(heartbeat),
    exit: (code) => process.exit(code),
  });
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(() => {
  // The startup failure is reported by a fixed code, never by the error
  // object: the exit code and the process's own crash output remain the
  // diagnostic path, and no error text reaches an ordinary log line.
  console.error("[worker] worker_event code=worker_start_failed");
  process.exit(1);
});
