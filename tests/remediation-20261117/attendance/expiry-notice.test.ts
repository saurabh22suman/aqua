import { afterEach, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "../../offline/fake-indexeddb";
import { activateOfflineIdentity, clearOfflineStorage, enqueueMark, kvGet, queueCount } from "@/lib/offline/idb";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("securely purges expired marks while retaining only a count-only loss notice", async () => {
  installFakeIndexedDB();
  const now = Date.now(), identity = { scope: "a".repeat(64), expiresAt: now + 1000 };
  await activateOfflineIdentity(identity);
  await enqueueMark({ clientId: "secret-operation", sessionId: "secret-session", memberId: "secret-member", status: "present", savedAt: now, attempts: 0, ...identity });
  vi.spyOn(Date, "now").mockReturnValue(now + 1001);
  await clearOfflineStorage(identity.scope);
  expect(await queueCount()).toBe(0);
  const notice = await kvGet("attendance-loss-notice");
  expect(notice).toEqual({ count: 1 });
  expect(JSON.stringify(notice)).not.toMatch(/secret|member|session|scope|present/);
  await clearOfflineStorage(identity.scope);
  await activateOfflineIdentity({ scope: "b".repeat(64), expiresAt: now + 5000 });
  expect(await kvGet("attendance-loss-notice")).toEqual({ count: 1 });
});

it("purges marks on scope switch and keeps only the count for the next session", async () => {
  installFakeIndexedDB();
  const now = Date.now(), first = { scope: "c".repeat(64), expiresAt: now + 60000 };
  await activateOfflineIdentity(first);
  await enqueueMark({ clientId: "private-op", sessionId: "private-session", memberId: "private-member", status: "late", savedAt: now, attempts: 0, ...first });
  expect(await activateOfflineIdentity({ scope: "d".repeat(64), expiresAt: now + 60000 })).toBe(true);
  expect(await queueCount()).toBe(0);
  expect(await kvGet("attendance-loss-notice")).toEqual({ count: 1 });
});
