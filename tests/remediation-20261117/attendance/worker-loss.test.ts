import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "../../offline/fake-indexeddb";
import { activateOfflineIdentity, clearOfflineStorage, enqueueMark, kvGet, kvSet, queueCount, scopedKvSet, storedOfflineIdentity } from "@/lib/offline/idb";
import { clearOfflineData } from "@/lib/offline/client-session";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("worker purge saves only the count and page purge does not double count", async () => {
  installFakeIndexedDB();
  const now = Date.now(), identity = { scope: "a".repeat(64), expiresAt: now + 1000 };
  await activateOfflineIdentity(identity);
  await enqueueMark({ ...identity, clientId: "private-op", memberId: "private-member", sessionId: "private-session", status: "present", savedAt: now, attempts: 0 });
  await scopedKvSet(identity, "roster:private-session", { name: "private-roster" });
  const worker = runInNewContext(`${readFileSync("public/sw.js", "utf8")}\n;clearRecords`, {
    self: { location: { origin: "https://example.test" }, addEventListener: () => {} }, URL, indexedDB, Response, Date,
  }) as (scope: string) => Promise<void>;
  vi.spyOn(Date, "now").mockReturnValue(now + 1001);
  await worker(identity.scope);
  await clearOfflineStorage(identity.scope);
  expect(await queueCount()).toBe(0);
  expect(await kvGet("attendance-loss-notice")).toEqual({ count: 1 });
  expect(await kvGet(`${identity.scope}:roster:private-session`)).toBeNull();
  expect(JSON.stringify(await kvGet("identity"))).not.toContain(identity.scope);
});
it("preserves legacy cache tombstones through repeated page and worker clears until verified replacement", async () => {
  installFakeIndexedDB();
  const scope = "e".repeat(64), fresh = { scope: "f".repeat(64), expiresAt: Date.now() + 60000 };
  await kvSet("identity", { blockedScope: scope });
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    open: async (name: string) => {
      let store = stores.get(name); if (!store) { store = new Map(); stores.set(name, store); }
      const current = store;
      return { match: async (key: string) => current.get(key)?.clone(), put: async (key: string, value: Response) => { current.set(key, value); } };
    },
    keys: async () => Array.from(stores.keys()),
    delete: async (name: string) => stores.delete(name),
  };
  vi.stubGlobal("window", { location: { origin: "https://example.test" }, caches, dispatchEvent: () => true });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("caches", caches);
  const meta = await caches.open("aqua-offline-state-v2"), key = "https://example.test/__aqua_offline_state";
  await meta.put(key, new Response(JSON.stringify({ blockedScope: scope })));
  const worker = runInNewContext(`${readFileSync("public/sw.js", "utf8")}\n;({ clear, refreshIdentity })`, {
    self: { location: { origin: "https://example.test" }, addEventListener: () => {}, clients: { matchAll: async () => [] } },
    URL, indexedDB, Response, Date, caches, fetch: async () => new Response(JSON.stringify({ authenticated: true, identity: fresh })),
  }) as { clear: (scope?: string) => Promise<void>; refreshIdentity: () => Promise<unknown> };
  await clearOfflineData(scope); await clearOfflineData();
  await worker.clear(scope); await worker.clear();
  expect(await (await meta.match(key))?.json()).toEqual({ blockedScope: scope });
  expect(await activateOfflineIdentity({ scope, expiresAt: Date.now() + 60000 })).toBe(false);
  expect(await worker.refreshIdentity()).toEqual(fresh);
  expect(await (await meta.match(key))?.json()).toEqual({ identity: fresh });
});
it("preserves a legacy deny marker across page and worker purges until a different verified scope replaces it", async () => {
  installFakeIndexedDB();
  const scope = "c".repeat(64), identity = { scope, expiresAt: Date.now() + 60000 };
  await activateOfflineIdentity(identity);
  await enqueueMark({ ...identity, clientId: "legacy-op", memberId: "legacy-member", sessionId: "legacy-session", status: "present", savedAt: Date.now(), attempts: 0 });
  await scopedKvSet(identity, "roster:legacy-session", { name: "legacy-private-roster" });
  await kvSet("identity", { blockedScope: scope });
  const worker = runInNewContext(`${readFileSync("public/sw.js", "utf8")}\n;clearRecords`, {
    self: { location: { origin: "https://example.test" }, addEventListener: () => {} }, URL, indexedDB, Response, Date,
  }) as (scope?: string) => Promise<void>;
  expect(await storedOfflineIdentity()).toBeNull();
  await clearOfflineStorage(scope); await clearOfflineStorage();
  await worker(scope); await worker();
  expect(await kvGet("identity")).toMatchObject({ blockedScope: scope });
  expect(await queueCount()).toBe(0);
  expect(await kvGet(`${scope}:roster:legacy-session`)).toBeNull();
  expect(JSON.stringify(await kvGet("attendance-loss-notice"))).not.toMatch(/legacy|member|session|roster|scope/);
  expect(await activateOfflineIdentity(identity)).toBe(false);
  const fresh = { scope: "d".repeat(64), expiresAt: Date.now() + 60000 };
  // A cached component cannot claim a different scope without the lifecycle's
  // server-verified expected-scope transition.
  expect(await activateOfflineIdentity(fresh)).toBe(false);
  expect(await activateOfflineIdentity(fresh, scope)).toBe(true);
  expect(await storedOfflineIdentity()).toEqual(fresh);
  expect(JSON.stringify(await kvGet("identity"))).not.toContain(scope);
});
it("retains a logout tombstone only until the original capability expires", async () => {
  installFakeIndexedDB();
  const now = Date.now(), identity = { scope: "b".repeat(64), expiresAt: now + 1000 };
  await activateOfflineIdentity(identity);
  await clearOfflineStorage(identity.scope);
  expect(await activateOfflineIdentity(identity)).toBe(false);
  vi.spyOn(Date, "now").mockReturnValue(now + 1001);
  await storedOfflineIdentity();
  expect(JSON.stringify(await kvGet("identity"))).not.toContain(identity.scope);
  expect(await activateOfflineIdentity(identity)).toBe(false);
});
