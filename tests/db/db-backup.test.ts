import { describe, expect, it } from "vitest";
import {
  assertDumpLooksValid,
  backupObjectKey,
  selectExpiredKeys,
} from "@/scripts/lib/db-backup";
import { isObjectStoreEnabled } from "@/lib/storage/object-store";

// PR1-C11 — backup key naming, retention selection and dump sanity.
// The live upload/restore path is exercised only where R2 credentials
// exist (the runbook's restore drill), never in CI.

describe("backupObjectKey", () => {
  it("is a sortable, URL-safe key under db-backups/", () => {
    const key = backupObjectKey(new Date("2026-09-21T11:15:30Z"));
    expect(key).toBe("db-backups/20260921T111530Z.dump");
  });

  it("sorts lexicographically in chronological order", () => {
    const older = backupObjectKey(new Date("2026-09-21T11:15:30Z"));
    const newer = backupObjectKey(new Date("2026-09-21T11:15:31Z"));
    expect([newer, older].sort()).toEqual([older, newer]);
  });
});

describe("selectExpiredKeys", () => {
  const keys = [
    "db-backups/20260919T020000Z.dump",
    "db-backups/20260920T020000Z.dump",
    "db-backups/20260921T020000Z.dump",
    "db-backups/20260922T020000Z.dump",
  ];

  it("keeps the newest N and prunes only older keys", () => {
    expect(selectExpiredKeys(keys, 2)).toEqual([
      "db-backups/20260919T020000Z.dump",
      "db-backups/20260920T020000Z.dump",
    ]);
  });

  it("ignores keys outside the backup prefix", () => {
    const mixed = [...keys, "audit-checkpoints/2026-09-21.json"];
    expect(selectExpiredKeys(mixed, 2)).toEqual([
      "db-backups/20260919T020000Z.dump",
      "db-backups/20260920T020000Z.dump",
    ]);
  });

  it("prunes nothing when there are fewer keys than the retention", () => {
    expect(selectExpiredKeys(keys, 10)).toEqual([]);
  });
});

describe("assertDumpLooksValid", () => {
  it("accepts a custom-format dump header", () => {
    expect(() =>
      assertDumpLooksValid(new TextEncoder().encode("PGDMP....rest")),
    ).not.toThrow();
  });

  it("rejects an empty dump", () => {
    expect(() => assertDumpLooksValid(new Uint8Array(0))).toThrow(/empty/i);
  });

  it("rejects bytes that are not a custom-format dump", () => {
    expect(() =>
      assertDumpLooksValid(new TextEncoder().encode("not a dump")),
    ).toThrow(/PGDMP/);
  });
});

describe.skipIf(!isObjectStoreEnabled())("R2 backup store (live)", () => {
  it("round-trips a small object under the backup prefix", async () => {
    const { getObjectStore } = await import("@/lib/storage/object-store");
    const store = getObjectStore();
    const key = backupObjectKey(new Date());
    await store.putObject(key, new TextEncoder().encode("PGDMPtest"), "application/octet-stream");
    expect(await store.getObject(key)).not.toBeNull();
    const listed = await store.listObjects("db-backups/");
    expect(listed).toContain(key);
    await store.deleteObject(key);
    expect(await store.getObject(key)).toBeNull();
  });
});
