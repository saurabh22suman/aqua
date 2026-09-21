import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

// PR1-C9 — one fixed session-level advisory lock serialises every
// runner (deploy script, CI, a human, two containers racing on a
// fresh database). Without it, concurrent runners race the
// `create table if not exists _migrations` (pg_type duplicate key)
// and the _migrations primary key, and can half-apply a migration.
// The value is arbitrary and stable: "aqua" as hex.
const MIGRATION_LOCK_KEY = 0x61717561;

export async function runMigrations(
  connectionString: string,
  options: { upToExclusive?: string } = {},
): Promise<number> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

    await client.query(`
      create table if not exists _migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const allFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    // upToExclusive exists for migration backfill tests: seed the
    // pre-migration shape, then apply the target migration last. The
    // ascending-order guard below always validates the full set.
    const files = options.upToExclusive
      ? allFiles.filter((f) => f < options.upToExclusive!)
      : allFiles;

    if (allFiles.length === 0) {
      throw new Error(`No migrations found in ${MIGRATIONS_DIR}`);
    }

    for (let i = 1; i < allFiles.length; i++) {
      const prev = allFiles[i - 1].match(/^(\d+)/)?.[1];
      const curr = allFiles[i].match(/^(\d+)/)?.[1];
      if (!prev || !curr || BigInt(curr) <= BigInt(prev)) {
        throw new Error(
          `Migration files must be numbered NNNN_name.sql in ascending order. Offending pair: ${allFiles[i - 1]}, ${allFiles[i]}`,
        );
      }
    }

    const { rows } = await client.query<{ name: string }>(
      "select name from _migrations",
    );
    const applied = new Set(rows.map((r) => r.name));

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`Applying ${file}... `);

      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into _migrations (name) values ($1)", [
          file,
        ]);
        await client.query("commit");
        console.log("ok");
        ran++;
      } catch (err) {
        await client.query("rollback");
        console.log("FAILED");
        throw err;
      }
    }

    console.log(
      ran === 0
        ? `Nothing to migrate (${files.length} already applied).`
        : `${ran} migration(s) applied, ${applied.size + ran}/${files.length} total.`,
    );

    return ran;
  } finally {
    await client
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
      .catch(() => {});
    await client.end();
  }
}

async function main(): Promise<void> {
  const { requireMigrationUrl } = await import("@/lib/env");
  await runMigrations(requireMigrationUrl("db/migrate.ts"));
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
