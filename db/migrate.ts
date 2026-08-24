import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

export async function runMigrations(connectionString: string): Promise<number> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      create table if not exists _migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      throw new Error(`No migrations found in ${MIGRATIONS_DIR}`);
    }

    for (let i = 1; i < files.length; i++) {
      const prev = files[i - 1].match(/^(\d+)/)?.[1];
      const curr = files[i].match(/^(\d+)/)?.[1];
      if (!prev || !curr || BigInt(curr) <= BigInt(prev)) {
        throw new Error(
          `Migration files must be numbered NNNN_name.sql in ascending order. Offending pair: ${files[i - 1]}, ${files[i]}`,
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
    await client.end();
  }
}

async function main(): Promise<void> {
  const { env } = await import("@/lib/env");
  await runMigrations(env.MIGRATION_DATABASE_URL);
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
