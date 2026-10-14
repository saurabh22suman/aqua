import { afterEach, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "./fake-indexeddb";
import { OFFLINE_IDENTITY } from "./fixture-identity";
import { activateOfflineIdentity, clearOfflineStorage, enqueueMark, queueAll, queueForIdentity, kvGet, scopedKvSet } from "@/lib/offline/idb";
afterEach(() => vi.unstubAllGlobals());

it("removes prior-session queues/rosters and never selects them under a new session", async () => {
  installFakeIndexedDB();
  await activateOfflineIdentity(OFFLINE_IDENTITY);
  await enqueueMark({ ...OFFLINE_IDENTITY, clientId: "old", sessionId: "s", memberId: "m", status: "present", savedAt: Date.now(), attempts: 0 });
  await scopedKvSet(OFFLINE_IDENTITY, "roster:s", { names: ["Synthetic private roster"] });
  const next = { ...OFFLINE_IDENTITY, scope: "b".repeat(64) };
  await activateOfflineIdentity(next);
  expect(await queueForIdentity(next)).toEqual([]);
  expect(await queueAll()).toEqual([]);
  expect(await kvGet(`${OFFLINE_IDENTITY.scope}:roster:s`)).toBeNull();
  await expect(enqueueMark({ ...OFFLINE_IDENTITY, clientId: "stale", sessionId: "s", memberId: "m", status: "present", savedAt: Date.now(), attempts: 0 })).rejects.toThrow("session ended");
});

it("blocks late writes and reactivation of the session cleared at logout", async () => {
  installFakeIndexedDB();
  await activateOfflineIdentity(OFFLINE_IDENTITY);
  await clearOfflineStorage();
  expect(await activateOfflineIdentity(OFFLINE_IDENTITY)).toBe(false);
  await expect(scopedKvSet(OFFLINE_IDENTITY, "roster:s", { names: ["Must not resurrect"] })).rejects.toThrow("session ended");
  expect(await activateOfflineIdentity({ ...OFFLINE_IDENTITY, scope: "c".repeat(64) })).toBe(true);
});

it("does not queue or return marks under an expired offline identity", async () => {
  installFakeIndexedDB();
  const expired = { ...OFFLINE_IDENTITY, expiresAt: Date.now() - 1 };
  expect(await activateOfflineIdentity(expired)).toBe(false);
  expect(await queueForIdentity(expired)).toEqual([]);
});
