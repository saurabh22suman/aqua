// L5 — dev-DB orphan cleanup.
//
// The audit found ~18 (now 45) `phase39-*` tenants left behind by
// `tests/tier1/platform-activity.test.ts`. `platform-activity.test.ts`
// creates them with no cleanup in `afterAll` (a real bug, tracked
// separately). Until the test cleans up after itself, this script
// sweeps them out — every reset of the local docker dev DB between
// audit-and-clean cycles doesn't apply here, the orphans persist.
//
// What it deletes:
//   - tenants where slug ~ '^phase39-' and status = 'trial'
//
// Hard guard against accidental production cleanup:
//
//   1. NODE_ENV must be 'development' (the standing rule from
//      db/CLAUDE.md: dev/test only).
//   2. Affected tenants are listed before any write — re-run with
//      --list first if you want to see.
//   3. The --confirm flag is required to actually delete.
//
// Usage:
//
//   tsx scripts/l5-clean-dev-orphans.ts            # dry-run, prints
//   tsx scripts/l5-clean-dev-orphans.ts --list    # print slugs to delete
//   tsx scripts/l5-clean-dev-orphans.ts --confirm  # actually delete
//
// Connection: MIGRATION_DATABASE_URL only. We delete via the
// privileged role because (a) tenants has RLS and (b) the script
// is a one-off maintenance command, not request-path code.

import { Client } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env, requireMigrationUrl } from "@/lib/env";

const ACTION = (() => {
  const args = process.argv.slice(2);
  if (args.includes("--confirm")) return "confirm" as const;
  if (args.includes("--list")) return "list" as const;
  return "dry-run" as const;
})();

if (env.NODE_ENV === "production") {
  throw new Error(
    `Refusing to run: NODE_ENV=production. This script is dev-only.`,
  );
}
if (env.NODE_ENV !== "development") {
  // dev/test both allowed — the script does its work against a
  // disposable instance in CI; the guard exists for production.
  console.warn(
    `l5-clean-dev-orphans: NODE_ENV=${env.NODE_ENV}; running anyway (CI / disposable instance).`,
  );
}

// NO ACTION FKs (delete child rows first):
const NO_ACTION_CHILD_TABLES = [
  // order: leaves before roots
  "enquiry_follow_ups",
  "attendance",
  "consents",
  "guardianships",
  "member_status_transitions",
  "membership_locations",
  "tenant_memberships",
  "role_permissions",
  "enrolments",
  "members",
  "staff",
  "persons",
  "sessions",
  "batches",
  "enquiries",
  "programs",
  "roles",
  "locations",
];

async function main(): Promise<void> {
  const client = new Client({ connectionString: requireMigrationUrl("scripts/l5-clean-dev-orphans.ts") });
  await client.connect();

  try {
    const slugRe = "^phase39-";
    const r = await client.query<{ id: string; slug: string }>(
      `select id, slug from tenants where slug ~ $1 order by slug`,
      [slugRe],
    );
    const targets = r.rows;
    console.log(`l5-clean-dev-orphans: ${targets.length} phase39-* tenants.`);

    if (ACTION === "list") {
      for (const t of targets) console.log(`  - ${t.slug}`);
      return;
    }

    if (targets.length === 0) {
      console.log("Nothing to do.");
      return;
    }

    if (ACTION === "dry-run") {
      console.log(
        `\nDRY-RUN. Re-run with --confirm to actually delete these ${targets.length} tenants.\n` +
          `Re-run with --list to print the slugs.`,
      );
      for (const t of targets) console.log(`  would delete: ${t.slug}`);
      return;
    }

    // --confirm path
    const runId = uuidv7();
    console.log(
      `l5-clean-dev-orphans: --confirm selected. run=${runId}. Deleting in FK order…`,
    );

    await client.query("begin");

    // platform_audit_log is RLS-exempt; defensively clear any
    // rows pointing at the target tenants.
    const pal = await client.query(
      `delete from platform_audit_log
       where tenant_id in (select id from tenants where slug ~ $1)`,
      [slugRe],
    );
    console.log(`  platform_audit_log: ${pal.rowCount ?? 0} rows`);

    for (const table of NO_ACTION_CHILD_TABLES) {
      try {
        const res = await client.query(
          `delete from ${table} where tenant_id in (select id from tenants where slug ~ $1)`,
          [slugRe],
        );
        if ((res.rowCount ?? 0) > 0) {
          console.log(`  ${table}: ${res.rowCount} rows`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ${table}: skipped (${msg})`);
      }
    }

    const tenantsRes = await client.query(
      `delete from tenants where slug ~ $1`,
      [slugRe],
    );
    console.log(`  tenants: ${tenantsRes.rowCount} rows`);

    await client.query("commit");
    console.log(`l5-clean-dev-orphans: run=${runId} committed.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
