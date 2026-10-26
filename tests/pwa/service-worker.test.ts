import { describe, expect, it } from "vitest";
import { createHarness, navigation } from "./service-worker-harness";

// The service worker's contract (docs/design-system/pwa.md):
//   * an update never takes over on its own — the page asks, after it
//     has checked that no attendance and no unsaved input would be lost;
//   * only the approved routes are cached, only GET, only same-origin;
//   * the private cache is bounded and its pages expire;
//   * financial and administrative writes are never answered from a
//     cache, and the signed parent surface is never touched.
//
// Agent-owned file (tests/pwa/**).

const PRIVATE = `aqua-private-v2-${"a".repeat(64)}`;

describe("the worker's update handshake", () => {
  it("takes over at once on a first install — there is nobody to disturb", async () => {
    const harness = createHarness({ activeWorker: false });
    await harness.dispatchInstall();
    expect(harness.skipWaitingCalls()).toBe(1);
  });

  it("waits on an update until the page asks for the handover", async () => {
    const harness = createHarness({ activeWorker: true });
    await harness.dispatchInstall();
    expect(harness.skipWaitingCalls()).toBe(0);
  });

  it("releases the waiting worker when the page asks", async () => {
    const harness = createHarness({ activeWorker: true });
    await harness.dispatchInstall();
    await harness.dispatchMessage({ type: "aqua-activate-update" });
    expect(harness.skipWaitingCalls()).toBe(1);
  });

  it("ignores any other message", async () => {
    const harness = createHarness({ activeWorker: true });
    await harness.dispatchInstall();
    const before = harness.skipWaitingCalls();
    await harness.dispatchMessage({ type: "something-else" });
    expect(harness.skipWaitingCalls()).toBe(before);
  });
});

describe("what the worker caches", () => {
  it("caches the approved offline attendance navigation for the signed-in scope", async () => {
    const harness = createHarness();
    const result = await harness.dispatchFetch(navigation("/coach/sessions/session-1"));
    expect(result.responded).toBe(true);
    expect(harness.cacheEntries(PRIVATE)).toContain("https://aqua.example/coach/sessions/session-1");
  });

  it("never answers a tenant page that is not approved for offline use", async () => {
    const harness = createHarness();
    for (const path of ["/owner", "/owner/fees", "/reception", "/parent"]) {
      const result = await harness.dispatchFetch(navigation(path));
      expect(result.responded, path).toBe(false);
    }
    expect(harness.cacheEntries(PRIVATE)).toEqual([]);
  });

  it("never touches the operator console or a signed parent link", async () => {
    const harness = createHarness();
    for (const path of ["/ops", "/ops/tenants/1", "/p/9f2c-secret-token"]) {
      const result = await harness.dispatchFetch(navigation(path));
      expect(result.responded, path).toBe(false);
    }
    expect(harness.cacheEntries(PRIVATE)).toEqual([]);
  });

  it("never answers an API call from a cache", async () => {
    const harness = createHarness();
    for (const path of ["/api/offline/session", "/api/receipts/1", "/api/payment-qr/1"]) {
      const result = await harness.dispatchFetch({ url: `https://aqua.example${path}`, method: "GET", mode: "cors" });
      expect(result.responded, path).toBe(false);
    }
  });

  it("never answers a write from a cache", async () => {
    const harness = createHarness();
    for (const path of ["/api/payments", "/api/fees", "/api/staff"]) {
      const result = await harness.dispatchFetch({ url: `https://aqua.example${path}`, method: "POST", mode: "cors" });
      expect(result.responded, path).toBe(false);
    }
  });

  it("keeps the private cache bounded", async () => {
    const harness = createHarness();
    for (let index = 0; index < 20; index++) {
      await harness.dispatchFetch(navigation(`/coach/sessions/session-${index}`));
    }
    const entries = harness.cacheEntries(PRIVATE);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(12);
    // The newest page survives; the oldest was evicted.
    expect(entries).toContain("https://aqua.example/coach/sessions/session-19");
    expect(entries).not.toContain("https://aqua.example/coach/sessions/session-0");
  });

  it("does not serve a page that has outlived the offline window", async () => {
    const harness = createHarness();
    await harness.dispatchFetch(navigation("/coach/sessions/session-1"));
    harness.setOffline(true);
    // Age the cached page past the window the worker is allowed to keep.
    const stale = new Response("<!doctype html><html><body>stale register</body></html>", {
      headers: { "Content-Type": "text/html", "x-aqua-cached-at": String(Date.now() - 48 * 3_600_000) },
    });
    await harness.seedCache(PRIVATE, "https://aqua.example/coach/sessions/session-1", stale);

    const result = await harness.dispatchFetch(navigation("/coach/sessions/session-1"));
    expect(result.responded).toBe(true);
    const body = await result.response?.text();
    expect(body).not.toContain("stale register");
    expect(body).toContain("not available offline");
  });

  it("keeps the public shell cache bounded and expires build leftovers", async () => {
    const harness = createHarness();
    // Build leftovers from an older deployment, well past their life.
    for (let index = 0; index < 5; index++) {
      await harness.seedCache(
        "aqua-shell-v2",
        `https://aqua.example/_next/static/chunks/old-${index}.js`,
        new Response("old", {
          headers: { "Content-Type": "application/javascript", "x-aqua-cached-at": String(Date.now() - 60 * 24 * 3_600_000) },
        }),
      );
    }
    await harness.seedCache(
      "aqua-shell-v2",
      "https://aqua.example/_next/static/chunks/current.js",
      new Response("current", {
        headers: { "Content-Type": "application/javascript", "x-aqua-cached-at": String(Date.now()) },
      }),
    );

    await harness.dispatchActivate();

    const entries = harness.cacheEntries("aqua-shell-v2");
    expect(entries).toContain("https://aqua.example/_next/static/chunks/current.js");
    expect(entries.filter(entry => entry.includes("/old-"))).toEqual([]);
  });

  it("does not serve a cached page once the offline identity has expired", async () => {    const harness = createHarness();
    await harness.dispatchFetch(navigation("/coach/sessions/session-1"));
    harness.setOffline(true);
    // The session expires while the device is offline: the stored
    // identity is past its expiry, so nothing may be unlocked with it.
    await harness.seedCache(
      "aqua-offline-state-v2",
      "https://aqua.example/__aqua_offline_state",
      new Response(JSON.stringify({ identity: { scope: "a".repeat(64), expiresAt: Date.now() - 1000 } })),
    );

    const result = await harness.dispatchFetch(navigation("/coach/sessions/session-1"));
    expect(result.responded).toBe(true);
    const body = await result.response?.text();
    expect(body).not.toContain("<main>register</main>");
    expect(body).toContain("not available offline");
  });
});
