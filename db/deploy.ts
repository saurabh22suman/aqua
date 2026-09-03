import { PgBoss } from "pg-boss";
import { Client } from "pg";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { runMigrations } from "@/db/migrate";
import { env } from "@/lib/env";
import {
  SESSIONS_GENERATE_QUEUE,
  scheduleSessionsGenerate,
} from "@/lib/jobs/sessions-generate-schedule";

type JobTenant = { id: string; timezone: string };

// Queues pg-boss must have before any worker starts. Creating a queue
// creates a new partition table under the hood — schema-level CREATE, a
// DDL right app_user deliberately does not have (see
// grantAppUserOnPgBossSchema below) — so it belongs here, in the
// privileged deploy step, not in the worker.
const QUEUES = [SESSIONS_GENERATE_QUEUE];

// pg-boss owns its own schema and version history (pgboss.version table) —
// deliberately NOT vendored into db/migrations alongside our own SQL.
// Copying pg-boss's generated, version-gated schema SQL into a
// hand-maintained forward-only migration would fight its own upgrade path
// the next time pg-boss itself changes schema version. Its own start()
// IS the migration step for its own schema: idempotent, safe to run on
// every deploy, and it self-upgrades on version bumps.
async function ensurePgBossQueues(boss: PgBoss): Promise<void> {
  for (const queue of QUEUES) {
    await boss.createQueue(queue);
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
async function syncSessionGenerateSchedules(boss: PgBoss, tenants: JobTenant[]): Promise<void> {
  const desired = new Set(tenants.map((t) => t.id));

  const existing = await boss.getSchedules(SESSIONS_GENERATE_QUEUE);
  for (const sched of existing) {
    if (sched.key && !desired.has(sched.key)) {
      await boss.unschedule(SESSIONS_GENERATE_QUEUE, sched.key);
    }
  }

  for (const t of tenants) {
    await scheduleSessionsGenerate(boss, t.id, t.timezone);
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
  console.log("bootstrapping roles (idempotent — invariant: bootstrap precedes migrate)...");
  await bootstrapRoles(env.MIGRATION_DATABASE_URL);

  await runMigrations(env.MIGRATION_DATABASE_URL);

  console.log("ensuring pg-boss schema, queues and per-tenant schedules (idempotent)...");
  const boss = new PgBoss(env.MIGRATION_DATABASE_URL);
  await boss.start();
  await ensurePgBossQueues(boss);
  const tenants = await fetchJobTenants(env.MIGRATION_DATABASE_URL);
  await syncSessionGenerateSchedules(boss, tenants);
  await boss.stop({ graceful: false, timeout: 5000 });

  await grantAppUserOnPgBossSchema(env.MIGRATION_DATABASE_URL);

  console.log(`deploy migration complete. ${tenants.length} tenant(s) scheduled.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
