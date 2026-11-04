// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F6 — the offline queue's ADMISSION and IDENTITY behaviour, measured
// before anything is changed.
//
// The finding raised in Phase 1 was that lib/offline/queue-schema.ts
// carries a comment that says ".strict() matters: an unexpected key …
// is refused rather than stored", while the schema itself is a plain
// z.object() — so zod strips unknown keys instead of refusing them.
//
// Before treating that as a defect, this file MEASURES what actually
// happens at the queue door:
//
//   * does an entry carrying an extra key contaminate the stored row?
//   * is the identity (scope + expiry) of an accepted entry preserved
//     exactly?
//   * which entries are actually refused?
//
// The measurements decide the outcome. A stripped key is not a
// security boundary violation by itself: what the queue stores is
// still exactly an attendance mark, and the identity that authorises
// the replay is unchanged. What would be a violation is CONTAMINATION
// (an extra key surviving into storage, or a foreign scope being
// accepted) — so that is what this file asserts.
//
// Agent-owned file.

import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "../../offline/fake-indexeddb";
import { OFFLINE_IDENTITY } from "../../offline/fixture-identity";

const { activateOfflineIdentity, enqueueMark, queueAll, queueForIdentity } = await import(
  "@/lib/offline/idb"
);

afterEach(() => vi.unstubAllGlobals());

const MARK = {
  ...OFFLINE_IDENTITY,
  clientId: "client-1",
  sessionId: "session-1",
  memberId: "member-1",
  status: "present" as const,
  savedAt: Date.now(),
  attempts: 0,
};

const SCHEMA_KEYS = [
  "clientId",
  "sessionId",
  "memberId",
  "status",
  "savedAt",
  "attempts",
  "scope",
  "expiresAt",
];

describe("F6 — what the offline queue actually admits", () => {
  it("stores an attendance mark", async () => {
    installFakeIndexedDB();
    await activateOfflineIdentity(OFFLINE_IDENTITY);
    await enqueueMark(MARK);
    expect(await queueAll()).toHaveLength(1);
  });

  it("an entry carrying an extra key is admitted, and the extra key is NOT stored", async () => {
    // The measured behaviour, not the comment's claim: zod's default
    // object parsing strips unknown keys, so the row that reaches
    // storage holds exactly the attendance shape. Nothing from the
    // extra key survives — there is no contamination.
    installFakeIndexedDB();
    await activateOfflineIdentity(OFFLINE_IDENTITY);
    const forged = { ...MARK, amountPaise: 250_000, note: "not an attendance field" } as never;
    await enqueueMark(forged);

    const stored = await queueAll();
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]!).sort()).toEqual([...SCHEMA_KEYS].sort());
    expect(stored[0]!).not.toHaveProperty("amountPaise");
    expect(stored[0]!).not.toHaveProperty("note");
  });

  it("the identity of an accepted entry is preserved exactly", async () => {
    installFakeIndexedDB();
    await activateOfflineIdentity(OFFLINE_IDENTITY);
    await enqueueMark({ ...MARK, amountPaise: 1 } as never);

    const stored = await queueAll();
    expect(stored[0]!.scope).toBe(OFFLINE_IDENTITY.scope);
    expect(stored[0]!.expiresAt).toBe(OFFLINE_IDENTITY.expiresAt);
    expect(stored[0]!.clientId).toBe(MARK.clientId);
    // The scope is the replay authorisation: the entry comes back
    // only for its own identity.
    expect(await queueForIdentity(OFFLINE_IDENTITY)).toHaveLength(1);
    expect(
      await queueForIdentity({ scope: "b".repeat(64), expiresAt: OFFLINE_IDENTITY.expiresAt }),
    ).toEqual([]);
  });

  it("refuses a mark whose scope is not the signed-in one", async () => {
    installFakeIndexedDB();
    await activateOfflineIdentity(OFFLINE_IDENTITY);
    await expect(
      enqueueMark({ ...MARK, scope: "c".repeat(64) } as never),
    ).rejects.toThrow();
    expect(await queueAll()).toEqual([]);
  });

  it("refuses a status outside the attendance set", async () => {
    installFakeIndexedDB();
    await activateOfflineIdentity(OFFLINE_IDENTITY);
    await expect(
      enqueueMark({ ...MARK, status: "refunded" } as never),
    ).rejects.toThrow();
    expect(await queueAll()).toEqual([]);
  });

  it("refuses a mark with no scope or no expiry", async () => {
    installFakeIndexedDB();
    await activateOfflineIdentity(OFFLINE_IDENTITY);
    const noScope = { ...MARK } as Record<string, unknown>;
    delete noScope.scope;
    await expect(enqueueMark(noScope as never)).rejects.toThrow();
    const noExpiry = { ...MARK } as Record<string, unknown>;
    delete noExpiry.expiresAt;
    await expect(enqueueMark(noExpiry as never)).rejects.toThrow();
    expect(await queueAll()).toEqual([]);
  });

  it("refuses a mark once the identity has expired", async () => {
    installFakeIndexedDB();
    const expired = { ...OFFLINE_IDENTITY, expiresAt: Date.now() - 1 };
    expect(await activateOfflineIdentity(expired)).toBe(false);
    await expect(
      enqueueMark({ ...MARK, scope: expired.scope, expiresAt: expired.expiresAt } as never),
    ).rejects.toThrow();
    expect(await queueAll()).toEqual([]);
  });
});
