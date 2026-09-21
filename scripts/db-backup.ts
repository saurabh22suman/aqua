import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  assertDumpLooksValid,
  backupObjectKey,
  selectExpiredKeys,
} from "./lib/db-backup";
import {
  getObjectStore,
  isObjectStoreEnabled,
} from "@/lib/storage/object-store";

// PR1-C11 — `pnpm db:backup [--retain N] [--dry-run]`.
//
// Dumps the database in pg_dump custom format, refuses an empty or
// non-archive dump, uploads it under db-backups/ and prunes older
// backups beyond the retention count. Requires:
//   - MIGRATION_DATABASE_URL (privileged connection; CLI only — this
//     script is never imported by the app)
//   - pg_dump on PATH (PostgreSQL 16 client; the postgres image ships
//     one — `docker exec aqua-db pg_dump …` is the runbook variant)
//   - R2_* variables (the upload must not silently no-op)
//
// The restore drill is documented in docs/deployment.md §Backups.

const DEFAULT_RETAIN = 7;

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function runPgDump(connectionString: string): Uint8Array {
  const probe = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  if (probe.error) {
    throw new Error(
      "pg_dump is not on PATH. Install the PostgreSQL 16 client, or run the dump from the database container and upload with `--from-file`.",
    );
  }
  const result = spawnSync(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges", connectionString],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `pg_dump failed (exit ${result.status}): ${result.stderr.toString().trim()}`,
    );
  }
  return new Uint8Array(result.stdout);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const retain = Number(argValue("--retain") ?? DEFAULT_RETAIN);
  if (!Number.isInteger(retain) || retain < 1) {
    throw new Error("--retain must be a positive integer.");
  }
  if (!isObjectStoreEnabled() && !dryRun) {
    throw new Error(
      "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET must all be set — a backup that is not uploaded is not a backup.",
    );
  }

  const { requireMigrationUrl } = await import("@/lib/env");
  const fromFile = argValue("--from-file");
  const bytes = fromFile
    ? new Uint8Array(readFileSync(fromFile))
    : runPgDump(requireMigrationUrl("scripts/db-backup.ts"));
  assertDumpLooksValid(bytes);

  const key = backupObjectKey(new Date());
  console.log(
    `Dumped ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB → ${key}`,
  );

  if (dryRun) {
    console.log("Dry run — upload and retention skipped.");
    return;
  }

  const store = getObjectStore();
  await store.putObject(key, bytes, "application/octet-stream");
  console.log(`Uploaded ${key}`);

  const existing = await store.listObjects("db-backups/");
  const expired = selectExpiredKeys(existing, retain);
  for (const oldKey of expired) {
    await store.deleteObject(oldKey);
    console.log(`Pruned ${oldKey}`);
  }
  console.log(
    `Retention: kept ${Math.min(retain, existing.length)} of ${existing.length} backup(s), pruned ${expired.length}.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
