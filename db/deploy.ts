import { PgBoss } from "pg-boss";
import { Client } from "pg";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { runMigrations } from "@/db/migrate";
import { requireMigrationUrl, env } from "@/lib/env";
import {
  SESSIONS_GENERATE_QUEUE,
  scheduleSessionsGenerate,
} from "@/lib/jobs/sessions-generate-schedule";
import {
  ABSENCE_ALERTS_QUEUE,
  scheduleAbsenceAlerts,
} from "@/lib/jobs/absence-alerts-schedule";
import {
  SUBSCRIPTIONS_EXPIRE_QUEUE,
  scheduleSubscriptionsExpire,
} from "@/lib/jobs/subscriptions-expire-schedule";
import {
  INVOICES_GENERATE_QUEUE,
  scheduleInvoicesGenerate,
} from "@/lib/jobs/invoices-generate-schedule";
import {
  REPORTS_ROLLUP_QUEUE,
  scheduleReportsRollup,
} from "@/lib/jobs/reports-rollup-schedule";
import {
  EVENTS_ROLLUP_QUEUE,
  scheduleEventsRollup,
} from "@/lib/jobs/events-rollup-schedule";
import {
  ACTIVITY_EXPORT_QUEUE,
  scheduleActivityExport,
} from "@/lib/jobs/activity-export-schedule";
import {
  AUDIT_CHECKPOINT_QUEUE,
  scheduleAuditCheckpoint,
} from "@/lib/jobs/audit-checkpoint-schedule";
import {
  PLATFORM_METRICS_SNAPSHOT_QUEUE,
  schedulePlatformMetricsSnapshot,
} from "@/lib/jobs/platform-metrics-snapshot-schedule";
import { ACTIVITY_INGEST_QUEUE } from "@/lib/jobs/activity-ingest-job";
import { WHATSAPP_NOTIFICATIONS_QUEUE, scheduleWhatsAppNotifications } from "@/lib/jobs/whatsapp-notifications-schedule";

type JobTenant = { id: string; timezone: string };

// Queues pg-boss must have before any worker starts. Creating a queue
// creates a new partition table under the hood — schema-level CREATE, a
// DDL right app_user deliberately does not have (see
// grantAppUserOnPgBossSchema below) — so it belongs here, in the
// privileged deploy step, not in the worker.
const QUEUES = [
  SESSIONS_GENERATE_QUEUE,
  ABSENCE_ALERTS_QUEUE,
  SUBSCRIPTIONS_EXPIRE_QUEUE,
  INVOICES_GENERATE_QUEUE,
  REPORTS_ROLLUP_QUEUE,
  EVENTS_ROLLUP_QUEUE,
  ACTIVITY_EXPORT_QUEUE,
  AUDIT_CHECKPOINT_QUEUE,
  PLATFORM_METRICS_SNAPSHOT_QUEUE,
  ACTIVITY_INGEST_QUEUE,
  WHATSAPP_NOTIFICATIONS_QUEUE,
];

type ScheduleFn = (
  boss: PgBoss,
  tenantId: string,
  timezone: string,
) => Promise<void>;

// pg-boss owns its own schema and version history (pgboss.version table) —
// deliberately NOT vendored into db/migrations alongside our own SQL.
// Copying pg-boss's generated, version-gated schema SQL into a
// hand-maintained forward-only migration would fight its own upgrade path
// the next time pg-boss itself changes schema version. Its own start()
// IS the migration step for its own schema: idempotent, safe to run on
// every deploy, and it self-upgrades on version bumps.
// F09 — the queue policy. Every queue this application schedules gets
// the same explicit policy, and every queue routes its terminally
// failed jobs to ONE dead-letter queue.
//
// The deployed policy was pg-boss v12's SCHEMA DEFAULT, because every
// queue was created with `boss.createQueue(queue)` and no options:
//   retry_limit = 2, retry_delay = 0, retry_backoff = false,
//   retry_delay_max = null, expire_seconds = 900, dead_letter = null
// — three attempts, NO delay between them, and no dead-letter queue
// anywhere in pgboss.queue (measured in the disposable database, not
// read from the library). docs/architecture.md §9 requires the
// opposite: "Retries use exponential backoff, three attempts, then
// dead-letter with an alert", and the alert table lists "job
// dead-letter" among the alerts that page.
//
// The units are SECONDS in pg-boss v12 (node_modules/pg-boss/dist/
// types.d.ts documents retryDelay as seconds; the milliseconds reading
// belongs to the v9 era).
const DEAD_LETTER_QUEUE = "dead.letter";

const QUEUE_POLICY = {
  // One try plus two retries = the three attempts the architecture
  // requires.
  retryLimit: 2,
  // 60 seconds before the first retry, doubling, capped at an hour.
  retryDelay: 60,
  retryBackoff: true,
  retryDelayMax: 3600,
  // A job that cannot finish inside 15 minutes is failed out (this is
  // the value the schema default already produced).
  expireInSeconds: 900,
  deadLetter: DEAD_LETTER_QUEUE,
};

// The dead-letter queue gets the SAME retry policy but NO deadLetter of
// its own: pg-boss refuses a queue that names itself as its dead
// letter ("deadLetter cannot be itself"), and a dead-lettered job must
// not be dead-lettered a second time.
const DEAD_LETTER_POLICY = {
  retryLimit: QUEUE_POLICY.retryLimit,
  retryDelay: QUEUE_POLICY.retryDelay,
  retryBackoff: QUEUE_POLICY.retryBackoff,
  retryDelayMax: QUEUE_POLICY.retryDelayMax,
  expireInSeconds: QUEUE_POLICY.expireInSeconds,
};

async function ensurePgBossQueues(boss: PgBoss): Promise<void> {
  // The dead-letter queue is created FIRST: pg-boss resolves the
  // deadLetter target while creating a queue, so a queue that names it
  // cannot be created before it exists.
  await boss.createQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_POLICY);
  // The dead-letter queue is UPDATEd too. createQueue() is ON CONFLICT
  // DO NOTHING inside pg-boss's create_queue() function, so an
  // EXISTING dead.letter queue would keep the schema default
  // (retry_delay 0, no backoff) — the same trap this function exists to
  // close for the other queues.
  await boss.updateQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_POLICY);
  for (const queue of QUEUES) {
    await boss.createQueue(queue, QUEUE_POLICY);
    // createQueue() is ON CONFLICT DO NOTHING inside pg-boss's
    // create_queue() function, so it does NOT change the policy of a
    // queue that already exists. On every deployed database the
    // queues already exist with the schema default, so the policy has
    // to be applied with updateQueue() as well — without this line the
    // whole change is a silent no-op on every existing deployment.
    await boss.updateQueue(queue, QUEUE_POLICY);
  }
}

// The worker never enumerates tenants — see docs/architecture.md's
// "Cross-tenant job scheduling" section for why (RLS has no policy
// satisfiable before a tenant is known, by design; this sidesteps that
// entirely rather than adding a bypass for it). One schedule per tenant,
// each carrying its own tenantId in `data` and keyed by tenantId so
// distinct tenants don't collide (pgboss.schedule's primary key is
// (name, key)). Stale schedules for tenants that churned or were deleted
// are removed here, not left to fire forever.
//
// One generic pass per queue — the sessions.generate and absence-alert
// syncs this replaced were identical apart from the queue name, and
// C-47 added three more queues of the same shape.
async function syncPerTenantSchedules(
  boss: PgBoss,
  queue: string,
  tenants: JobTenant[],
  schedule: ScheduleFn,
): Promise<void> {
  const desired = new Set(tenants.map((t) => t.id));

  const existing = await boss.getSchedules(queue);
  for (const sched of existing) {
    if (sched.key && !desired.has(sched.key)) {
      await boss.unschedule(queue, sched.key);
    }
  }

  for (const t of tenants) {
    await schedule(boss, t.id, t.timezone);
  }
}

// Read directly under the privileged connection — the one place in this
// codebase that legitimately needs every tenant, and the one place
// that's already exempt from needing a tenant/user scope to read
// `tenants` (superuser bypasses RLS unconditionally). D2 — this sync is
// no longer the only path to a schedule: createTenant()
// (db/platform-tenant-create.ts) registers a tenant's schedule
// immediately, right after its create transaction commits. This bulk
// sync remains the reconciliation pass: it catches tenants whose
// immediate registration failed (best-effort, logged, non-fatal — see
// createTenant), and removes schedules for tenants that churned or
// were suspended since the last deploy.
async function fetchJobTenants(connectionString: string): Promise<JobTenant[]> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<JobTenant>(
      "select id, timezone from tenants where status in ('trial', 'active')",
    );
    return rows;
  } finally {
    await client.end();
  }
}

// pg-boss's start() runs as `aqua` (superuser, via MIGRATION_DATABASE_URL)
// and owns the schema it creates. The worker must run as app_user, same
// as everything else — this grants exactly what ongoing job processing
// needs, and the ALTER DEFAULT PRIVILEGES lines cover tables pg-boss
// creates later (e.g. per-queue partitions on createQueue()) without a
// second manual grant step. Mirrors bootstrap-roles.ts's public-schema
// grants.
async function grantAppUserOnPgBossSchema(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("grant usage on schema pgboss to app_user");
    await client.query(
      "grant select, insert, update, delete on all tables in schema pgboss to app_user",
    );
    await client.query(
      "alter default privileges in schema pgboss grant select, insert, update, delete on tables to app_user",
    );
    await client.query("grant usage, select on all sequences in schema pgboss to app_user");
    await client.query(
      "alter default privileges in schema pgboss grant usage, select on sequences to app_user",
    );
    await client.query("grant execute on all functions in schema pgboss to app_user");
    await client.query(
      "alter default privileges in schema pgboss grant execute on functions to app_user",
    );
  } finally {
    await client.end();
  }
}

// The one-shot step that runs BEFORE web or worker start, under the
// privileged role (MIGRATION_DATABASE_URL) — never from the app
// container at boot (tests/tier1/no-superuser-on-request-path.test.ts
// enforces that MIGRATION_DATABASE_URL never reaches request-path code).
async function main(): Promise<void> {
  const migrationUrl = requireMigrationUrl("db/deploy.ts");
  console.log("bootstrapping roles (idempotent — invariant: bootstrap precedes migrate)...");
  await bootstrapRoles(migrationUrl);

  await runMigrations(migrationUrl);
  // Defaults apply to newly created tables; restrict their grants on this
  // first deploy, before web/worker can start serving requests.
  const { reconcileAppPrivileges } = await import("./app-privileges");
  await reconcileAppPrivileges(migrationUrl);

  console.log("ensuring pg-boss schema, queues and per-tenant schedules (idempotent)...");
  const boss = new PgBoss(migrationUrl);
  await boss.start();
  await ensurePgBossQueues(boss);
  const tenants = await fetchJobTenants(migrationUrl);
  await syncPerTenantSchedules(boss, SESSIONS_GENERATE_QUEUE, tenants, scheduleSessionsGenerate);
  await syncPerTenantSchedules(boss, ABSENCE_ALERTS_QUEUE, tenants, scheduleAbsenceAlerts);
  await syncPerTenantSchedules(boss, WHATSAPP_NOTIFICATIONS_QUEUE, tenants, scheduleWhatsAppNotifications);
  await syncPerTenantSchedules(boss, SUBSCRIPTIONS_EXPIRE_QUEUE, tenants, scheduleSubscriptionsExpire);
  await syncPerTenantSchedules(boss, INVOICES_GENERATE_QUEUE, tenants, scheduleInvoicesGenerate);
  await syncPerTenantSchedules(boss, REPORTS_ROLLUP_QUEUE, tenants, scheduleReportsRollup);
  await syncPerTenantSchedules(boss, EVENTS_ROLLUP_QUEUE, tenants, scheduleEventsRollup);
  await syncPerTenantSchedules(boss, ACTIVITY_EXPORT_QUEUE, tenants, scheduleActivityExport);
  await syncPerTenantSchedules(boss, AUDIT_CHECKPOINT_QUEUE, tenants, scheduleAuditCheckpoint);
  // Single global schedule, not per-tenant — see worker/index.ts for
  // why this one job carries no tenantId at all.
  await schedulePlatformMetricsSnapshot(boss);
  await boss.stop({ graceful: false, timeout: 5000 });

  await grantAppUserOnPgBossSchema(migrationUrl);

  // Synthetic club for a demo deployment. Opt-in only: the flag has
  // to be set in the deployment's environment, and the seeder refuses
  // to run without a PIN for its staff. Idempotent — re-running the
  // deploy refreshes nothing and duplicates nothing.
  if (env.SEED_SPLASH_CLUB) {
    console.log("seeding the Splash Sports Club (synthetic demo data)...");
    const { seedSplashSportsClub } = await import("./seed-splash-club");
    await seedSplashSportsClub({
      enabled: env.SEED_SPLASH_CLUB,
      pin: env.SEED_SPLASH_CLUB_PIN,
    });
  }

  console.log(`deploy migration complete. ${tenants.length} tenant(s) scheduled.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
