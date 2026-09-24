import { describe, expect, it } from "vitest";
import {
  assertDumpLooksValid,
  backupObjectKey,
  selectExpiredKeys,
  uploadBackup,
} from "@/scripts/lib/db-backup";
import { isObjectStoreEnabled } from "@/lib/storage/object-store";
import { FakeObjectStore } from "@/tests/helpers/fake-object-store";

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

describe("backup upload and retention (in-memory store)", () => {
  it("uploads a validated dump before pruning only older backup keys", async () => {
    const store = new FakeObjectStore();
    const dump = new TextEncoder().encode("PGDMPtest archive");
    for (const day of ["2026-09-21", "2026-09-22"]) {
      await uploadBackup(store, dump, new Date(`${day}T03:00:00Z`), 30);
    }
    store.objects.set("activity-events/keep.ndjson.gz", { bytes: dump, contentType: "application/gzip" });
    const result = await uploadBackup(store, dump, new Date("2026-09-23T03:00:00Z"), 2);
    expect(result).toEqual({ key: "db-backups/20260923T030000Z.dump", pruned: ["db-backups/20260921T030000Z.dump"] });
    expect(await store.getObject(result.key)).toEqual(dump);
    expect(await store.getObject("db-backups/20260922T030000Z.dump")).toEqual(dump);
    expect(await store.getObject("activity-events/keep.ndjson.gz")).toEqual(dump);
  });

  it("refuses invalid dumps and never prunes if the upload fails", async () => {
    const store = new FakeObjectStore();
    const older = "db-backups/20260920T030000Z.dump";
    store.objects.set(older, { bytes: new TextEncoder().encode("PGDMPold"), contentType: "application/octet-stream" });
    await expect(uploadBackup(store, new Uint8Array(0), new Date("2026-09-23"), 1)).rejects.toThrow(/empty/);
    expect(store.putCalls).toBe(0);
    store.putObject = async () => { throw new Error("offline upload"); };
    await expect(uploadBackup(store, new TextEncoder().encode("PGDMPnew"), new Date("2026-09-23"), 1)).rejects.toThrow(/offline upload/);
    expect(await store.getObject(older)).not.toBeNull();
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
