// @vitest-environment jsdom
//
// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F10 — the scoped offline clear must remove the cache the app
// actually creates.
//
// The gap: public/sw.js declares `const SHELL = "aqua-shell-v2"`, but
// three places in the worker and one place in
// lib/offline/client-session.ts still delete the OLD name
// "aqua-shell-v1". So a scoped clear (logout, session switch,
// tenant switch) never removed the live shell cache — the code said
// "delete the shell cache" and deleted nothing.
//
// Nothing private is at stake: the shell cache holds only public,
// fingerprinted build assets (public/sw.js), never tenant data. The
// consequence is stale build chunks lingering until the 30-day prune,
// plus two files that disagree about the cache's name.
//
// This file drives the REAL worker (tests/pwa/service-worker-harness.ts
// evaluates public/sw.js in a VM with fake caches) and the REAL page
// helper (lib/offline/client-session.ts) against ISOLATED fixture
// caches. No real browser profile, no real offline queue and no
// unrelated account or tenant is touched: every cache in this file is
// created and removed inside the test.
//
// Agent-owned file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "../../pwa/service-worker-harness";
import { installFakeIndexedDB } from "../../offline/fake-indexeddb";
import { OFFLINE_IDENTITY } from "../../offline/fixture-identity";

const { clearOfflineData } = await import("@/lib/offline/client-session");
const { activateOfflineIdentity, queueAll } = await import("@/lib/offline/idb");

const META_CACHE = "aqua-offline-state-v2";
const SHELL_CACHE = "aqua-shell-v2";
/** The page reads the state back from this exact URL (lib/offline/client-session.ts). */
const metaKey = (): string => new URL("/__aqua_offline_state", window.location.origin).href;
/** The worker's origin in the harness, so its own META_KEY resolves. */
const HARNESS_META_KEY = "https://aqua.example/__aqua_offline_state";

const OTHER_SCOPE = "b".repeat(64);

type FakeCache = { name: string; entries: Map<string, unknown> };

function fakeCacheStorage(): {
  caches: CacheStorage & { __caches: Map<string, FakeCache> };
} {
  const store = new Map<string, FakeCache>();
  const get = (name: string): FakeCache => {
    let cache = store.get(name);
    if (!cache) {
      cache = { name, entries: new Map() };
      store.set(name, cache);
    }
    return cache;
  };
  const asCache = (name: string): Cache => {
    const cache = get(name);
    return {
      async put(request: unknown, response: Response) {
        const url = typeof request === "string" ? request : String((request as { url: string }).url);
        cache.entries.set(url, response);
      },
      async match(request: unknown) {
        const url = typeof request === "string" ? request : String((request as { url: string }).url);
        const hit = cache.entries.get(url);
        return hit ? (hit as Response) : undefined;
      },
      async keys() {
        return [...cache.entries.keys()].map((url) => ({ url }));
      },
      async delete(request: unknown) {
        const url = typeof request === "string" ? request : String((request as { url: string }).url);
        return cache.entries.delete(url);
      },
    } as unknown as Cache;
  };
  const caches = {
    __caches: store,
    async open(name: string) {
      return asCache(name);
    },
    async keys() {
      return [...store.keys()];
    },
    async delete(name: string) {
      return store.delete(name);
    },
    async match(request: unknown) {
      const url = typeof request === "string" ? request : String((request as { url: string }).url);
      for (const cache of store.values()) {
        const hit = cache.entries.get(url);
        if (hit) return hit as Response;
      }
      return undefined as unknown as Response;
    },
  } as unknown as CacheStorage & { __caches: Map<string, FakeCache> };
  return { caches };
}

beforeEach(() => {
  installFakeIndexedDB();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F10 — the scoped clear removes the shell cache the app actually creates", () => {
  it("the worker clears the live shell cache, keeps other scopes' caches", async () => {
    const harness = createHarness({
      identity: { scope: OFFLINE_IDENTITY.scope, expiresAt: Date.now() + 3_600_000 },
    });

    // The worker holds the state that says who is signed in, plus the
    // three caches a signed-in device keeps: this scope's private
    // pages, another scope's private pages, and the public shell.
    await harness.seedCache(
      META_CACHE,
      HARNESS_META_KEY,
      new Response(JSON.stringify({ identity: OFFLINE_IDENTITY })),
    );
    await harness.seedCache(
      `aqua-private-v2-${OFFLINE_IDENTITY.scope}`,
      "https://aqua.example/coach/register",
      new Response("<html>mine</html>"),
    );
    await harness.seedCache(
      `aqua-private-v2-${OTHER_SCOPE}`,
      "https://aqua.example/coach/register",
      new Response("<html>theirs</html>"),
    );
    await harness.seedCache(
      SHELL_CACHE,
      "https://aqua.example/_next/static/chunk.js",
      new Response("console.log(1)"),
    );

    expect(harness.cacheNames()).toContain(SHELL_CACHE);

    await harness.dispatchMessage({ type: "aqua-clear-offline", scope: OFFLINE_IDENTITY.scope });

    const names = harness.cacheNames();
    // This scope's private pages are gone, another scope's are not.
    expect(names).not.toContain(`aqua-private-v2-${OFFLINE_IDENTITY.scope}`);
    expect(names).toContain(`aqua-private-v2-${OTHER_SCOPE}`);
    // The shell cache — the one the worker actually creates — is gone.
    expect(names).not.toContain(SHELL_CACHE);
  });

  it("the page helper clears the live shell cache and leaves other scopes alone", async () => {
    const { caches } = fakeCacheStorage();
    vi.stubGlobal("caches", caches);

    await activateOfflineIdentity(OFFLINE_IDENTITY);
    await caches.open(`aqua-private-v2-${OFFLINE_IDENTITY.scope}` as never);
    (caches as unknown as { __caches: Map<string, FakeCache> }).__caches.get(
      `aqua-private-v2-${OFFLINE_IDENTITY.scope}`,
    )!.entries.set("https://aqua.example/coach/register", new Response("mine"));
    await caches.open(`aqua-private-v2-${OTHER_SCOPE}` as never);
    (caches as unknown as { __caches: Map<string, FakeCache> }).__caches.get(
      `aqua-private-v2-${OTHER_SCOPE}`,
    )!.entries.set("https://aqua.example/coach/register", new Response("theirs"));
    await caches.open(SHELL_CACHE as never);
    (caches as unknown as { __caches: Map<string, FakeCache> }).__caches.get(
      SHELL_CACHE,
    )!.entries.set("https://aqua.example/_next/static/chunk.js", new Response("chunk"));

    // The meta cache holds the state the page reads back.
    await caches.open(META_CACHE as never);
    (caches as unknown as { __caches: Map<string, FakeCache> }).__caches
      .get(META_CACHE)!
      .entries.set(metaKey(), new Response(JSON.stringify({ identity: OFFLINE_IDENTITY })));

    const cleared = await clearOfflineData(OFFLINE_IDENTITY.scope);
    expect(cleared).toBe(true);

    const names = [...caches.__caches.keys()];
    expect(names).not.toContain(`aqua-private-v2-${OFFLINE_IDENTITY.scope}`);
    expect(names).toContain(`aqua-private-v2-${OTHER_SCOPE}`);
    expect(names).not.toContain(SHELL_CACHE);
    // The meta cache survives: it now carries the logout tombstone
    // that stops this scope being re-activated.
    expect(names).toContain(META_CACHE);
  });

  it("the clear does not take the unsynced queue with it for another scope", async () => {
    // The offline queue belongs to the identity that created it. A
    // scoped clear for THIS identity is allowed to clear this
    // identity's queue (that is the logout contract), but it must not
    // reach into another scope's storage.
    const { caches } = fakeCacheStorage();
    vi.stubGlobal("caches", caches);
    await activateOfflineIdentity(OFFLINE_IDENTITY);
    await caches.open(META_CACHE as never);
    (caches as unknown as { __caches: Map<string, FakeCache> }).__caches
      .get(META_CACHE)!
      .entries.set(metaKey(), new Response(JSON.stringify({ identity: OFFLINE_IDENTITY })));

    const other = { scope: OTHER_SCOPE, expiresAt: Date.now() + 3_600_000 };
    await activateOfflineIdentity(other);
    await activateOfflineIdentity(OFFLINE_IDENTITY);

    // The scope switch cleared the queue (the isolation contract in
    // tests/offline/identity-isolation.test.ts), so there is nothing
    // left to preserve — but the clear itself must not throw or wipe
    // a queue it does not own.
    expect(await queueAll()).toEqual([]);
    await expect(clearOfflineData(OFFLINE_IDENTITY.scope)).resolves.toBe(true);
  });
});
