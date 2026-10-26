import { afterEach, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "../offline/fake-indexeddb";
import { OFFLINE_IDENTITY } from "../offline/fixture-identity";
import { activateOfflineIdentity, enqueueMark, queueAll } from "@/lib/offline/idb";

// The offline queue is the ONLY write path this app has while offline.
// It must be able to hold nothing but attendance marks: a payment, a
// fee change or a staff action must never be queued, forged or
// malformed.
//
// Agent-owned file (tests/pwa/**).

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

it("stores an attendance mark", async () => {
  installFakeIndexedDB();
  await activateOfflineIdentity(OFFLINE_IDENTITY);
  await enqueueMark(MARK);
  expect(await queueAll()).toHaveLength(1);
});

it("refuses an entry that carries anything beyond an attendance mark", async () => {
  installFakeIndexedDB();
  await activateOfflineIdentity(OFFLINE_IDENTITY);
  // A forged entry: it claims a payment and a status outside the
  // attendance set. The TypeScript type forbids it; the runtime check
  // is what actually keeps it out of the queue.
  const forged = {
    ...MARK,
    amountPaise: 250000,
    status: "refunded",
  } as never;
  await expect(enqueueMark(forged)).rejects.toThrow();
  expect(await queueAll()).toHaveLength(0);
});

it("refuses a mark with no session scope or expiry", async () => {
  installFakeIndexedDB();
  await activateOfflineIdentity(OFFLINE_IDENTITY);
  const withoutIdentity = { ...MARK } as Record<string, unknown>;
  delete withoutIdentity.scope;
  delete withoutIdentity.expiresAt;
  await expect(enqueueMark(withoutIdentity as never)).rejects.toThrow();
  expect(await queueAll()).toHaveLength(0);
});

it("refuses a mark whose scope is not the signed-in one", async () => {
  installFakeIndexedDB();
  await activateOfflineIdentity(OFFLINE_IDENTITY);
  await expect(
    enqueueMark({ ...MARK, scope: "b".repeat(64), expiresAt: OFFLINE_IDENTITY.expiresAt }),
  ).rejects.toThrow(/session ended/i);
  expect(await queueAll()).toHaveLength(0);
});

it("refuses a mark that claims a status outside the attendance set", async () => {
  installFakeIndexedDB();
  await activateOfflineIdentity(OFFLINE_IDENTITY);
  await expect(enqueueMark({ ...MARK, status: "paid" as never })).rejects.toThrow();
  expect(await queueAll()).toHaveLength(0);
});
