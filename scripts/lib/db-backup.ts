// PR1-C11 — pure helpers for the database backup script. Kept free of
// pg/R2 imports so the retention and sanity rules are unit-testable;
// scripts/db-backup.ts wires them to pg_dump and the object store.
import type { ObjectStore } from "@/lib/storage/object-store";

const BACKUP_PREFIX = "db-backups/";
const DUMP_MAGIC = "PGDMP";

export function backupObjectKey(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${BACKUP_PREFIX}${stamp}.dump`;
}

// Lexicographic order is chronological order for this key shape.
// Returns the expired keys oldest-first; the newest `retain` survive.
export function selectExpiredKeys(keys: string[], retain: number): string[] {
  const backups = keys
    .filter((key) => key.startsWith(BACKUP_PREFIX))
    .sort();
  const expiredCount = Math.max(0, backups.length - Math.max(0, retain));
  return backups.slice(0, expiredCount);
}

export function assertDumpLooksValid(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) {
    throw new Error("Backup dump is empty — refusing to upload it.");
  }
  const header = new TextDecoder().decode(bytes.slice(0, DUMP_MAGIC.length));
  if (header !== DUMP_MAGIC) {
    throw new Error(
      `Backup dump does not start with ${DUMP_MAGIC} — not a pg_dump custom-format archive.`,
    );
  }
}

// Upload before pruning. If PUT or LIST fails, no older backup is
// deleted; a retry is safe. The CLI uses this same path as tests.
export async function uploadBackup(
  store: ObjectStore,
  bytes: Uint8Array,
  now: Date,
  retain: number,
): Promise<{ key: string; pruned: string[] }> {
  assertDumpLooksValid(bytes);
  const key = backupObjectKey(now);
  await store.putObject(key, bytes, "application/octet-stream");
  const expired = selectExpiredKeys(await store.listObjects("db-backups/"), retain);
  for (const oldKey of expired) await store.deleteObject(oldKey);
  return { key, pruned: expired };
}
