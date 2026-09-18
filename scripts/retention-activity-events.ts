import { Client } from "pg";
import { env } from "@/lib/env";
import { getObjectStore, isObjectStoreEnabled } from "@/lib/storage/object-store";
import { activityExportObjectKey } from "@/lib/jobs/activity-export-job";
import {
  selectDroppablePartitions,
  type RetentionPartition,
} from "./lib/retention-partitions";

// E-06 retention — OPERATOR-run, never scheduled, never in CI or app
// runtime. The ONLY path that may DROP an activity_events partition.
//
// Why a script and not a job: partition DROP is DDL, and the app role
// has no DDL; MIGRATION_DATABASE_URL is deliberately kept out of the
// worker (tests/tier1/no-superuser-on-request-path.test.ts). The
// plan's nightly job drops raw partitions "past the configured
// window" — that half stays manual until a privileged DDL path lands
// (H-03), and this script is that manual path.
//
// Safety rails, in order:
//   1. --i-understand is required; without it this exits before
//      connecting.
//   2. --older-than-days <n> controls the cutoff (default 180). The
//      script prints every partition it is about to drop, with its
//      range.
//   3. Before dropping anything it checks that every tenant-day inside
//      each candidate partition has an export object
//      (activity-events/<tenantId>/<date>.ndjson.gz, written by
//      lib/jobs/activity-export-job.ts). A single missing object
//      refuses the whole run unless --skip-export-check is passed.
//   4. The DROP only runs when MIGRATION_DATABASE_URL is set. Without
//      it the script lists, refuses, and exits 1 — it never falls back
//      to running DDL as the app role.
//
// Usage:
//   tsx scripts/retention-activity-events.ts --i-understand
//   tsx scripts/retention-activity-events.ts --i-understand --older-than-days 365
//   tsx scripts/retention-activity-events.ts --i-understand --skip-export-check

const USAGE =
  "Usage: tsx scripts/retention-activity-events.ts --i-understand [--older-than-days <n>] [--skip-export-check]";

function fail(message: string): never {
  console.error(`retention-activity-events: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  olderThanDays: number;
  skipExportCheck: boolean;
} {
  if (!argv.includes("--i-understand")) {
    console.error(USAGE);
    fail(
      "--i-understand is required: this command permanently DROPs activity_events partitions.",
    );
  }

  let olderThanDays = 180;
  const flagIndex = argv.indexOf("--older-than-days");
  if (flagIndex !== -1) {
    const raw = argv[flagIndex + 1];
    const parsed = Number(raw);
    if (
      raw === undefined ||
      raw.startsWith("--") ||
      !Number.isInteger(parsed) ||
      parsed <= 0
    ) {
      fail("--older-than-days needs a positive integer (e.g. --older-than-days 180)");
    }
    olderThanDays = parsed;
  }

  return { olderThanDays, skipExportCheck: argv.includes("--skip-export-check") };
}

// `pg_get_expr(relpartbound)` renders a range partition as
// `FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00')`.
// Anything else (a default partition, a hash partition) is skipped —
// this script only ever drops whole monthly ranges.
function parseRangeBound(
  name: string,
  bound: string | null,
): RetentionPartition | null {
  const match = bound?.match(/FROM \('([^']+)'\) TO \('([^']+)'\)/);
  if (!match) {
    console.warn(
      `retention-activity-events: ${name} has an unrecognised bound (${bound ?? "null"}) — skipped`,
    );
    return null;
  }
  return { name, from: new Date(match[1]!), to: new Date(match[2]!) };
}

function assertDroppableName(name: string): void {
  if (!/^activity_events_[0-9_]+$/.test(name)) {
    fail(`refusing to DROP unexpected partition name "${name}"`);
  }
}

async function main(): Promise<void> {
  const { olderThanDays, skipExportCheck } = parseArgs(process.argv.slice(2));
  const migrationUrl = env.MIGRATION_DATABASE_URL;
  const privileged = migrationUrl !== undefined;

  const client = new Client({ connectionString: migrationUrl ?? env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string; bound: string | null }>(
      `select c.relname as name,
              pg_get_expr(c.relpartbound, c.oid) as bound
         from pg_class c
         join pg_inherits i on i.inhrelid = c.oid
        where i.inhparent = 'activity_events'::regclass
        order by c.relname`,
    );
    const partitions = rows
      .map((row) => parseRangeBound(row.name, row.bound))
      .filter((p): p is RetentionPartition => p !== null);

    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const droppable = selectDroppablePartitions(partitions, cutoff);

    console.log(
      `retention-activity-events: ${partitions.length} partition(s), ` +
        `cutoff ${cutoff.toISOString()} (--older-than-days ${olderThanDays}), ` +
        `${droppable.length} droppable. Role: ${privileged ? "privileged (aqua)" : "app_user"}.`,
    );
    for (const partition of droppable) {
      console.log(
        `  would drop ${partition.name} [${partition.from.toISOString()}, ${partition.to.toISOString()})`,
      );
    }

    if (droppable.length === 0) {
      console.log("retention-activity-events: nothing to drop.");
      return;
    }

    if (!skipExportCheck) {
      if (!privileged) {
        fail(
          "--skip-export-check was not passed and MIGRATION_DATABASE_URL is not set: checking exports requires reading across partitions, which needs the privileged pool.",
        );
      }
      if (!isObjectStoreEnabled()) {
        fail(
          "the object store is disabled (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET not all set) and --skip-export-check was not passed — cannot verify that every tenant-day was exported.",
        );
      }
      const store = getObjectStore();
      const missing: string[] = [];
      for (const partition of droppable) {
        assertDroppableName(partition.name);
        const { rows: dayRows } = await client.query<{
          tenant_id: string;
          local_date: string;
        }>(
          `select distinct p.tenant_id::text as tenant_id,
                  to_char((p.occurred_at at time zone t.timezone)::date, 'YYYY-MM-DD') as local_date
             from "${partition.name}" p
             join tenants t on t.id = p.tenant_id
            order by 1, 2`,
        );
        for (const day of dayRows) {
          const key = activityExportObjectKey(day.tenant_id, day.local_date);
          const object = await store.getObject(key);
          if (object === null) missing.push(key);
        }
      }
      if (missing.length > 0) {
        console.error(
          `retention-activity-events: refusing to drop — ${missing.length} tenant-day export object(s) are missing. First 10:`,
        );
        for (const key of missing.slice(0, 10)) console.error(`  ${key}`);
        fail(
          "export every tenant-day first, or re-run with --skip-export-check to accept the data loss.",
        );
      }
    }

    if (!privileged) {
      fail(
        "dropping partitions requires DDL privileges: set MIGRATION_DATABASE_URL and re-run (listing above is the dry run).",
      );
    }

    for (const partition of droppable) {
      assertDroppableName(partition.name);
      await client.query(`drop table "${partition.name}"`);
      console.log(`retention-activity-events: dropped ${partition.name}`);
    }
    console.log(
      `retention-activity-events: dropped ${droppable.length} partition(s).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
