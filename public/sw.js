const SHELL = "aqua-shell-v2", META = "aqua-offline-state-v2";
const META_KEY = new URL("/__aqua_offline_state", self.location.origin).href;
let generation = 0;
let cacheMutation = Promise.resolve();
function mutateCaches(work) { const next = cacheMutation.then(work); cacheMutation = next.catch(() => {}); return next; }

// The routes this worker is allowed to serve offline, and the routes it
// must never touch. The list is deliberately short: installability is
// not universal offline capability, and the approved offline surface is
// the coach's attendance register — nothing else.
//
//   OFFLINE_NAVIGATION — GET navigations whose HTML may be kept for
//     offline use, partitioned by the signed-in identity.
//   NEVER_CACHED      — paths that carry a credential, belong to the
//     operator console, or are API traffic. They are never stored and
//     never answered from a cache.
const OFFLINE_NAVIGATION = /^\/coach(\/|$)/;
const NEVER_CACHED = [/^\/api(\/|$)/, /^\/ops(\/|$)/, /^\/p(\/|$)/, /^\/login(\/|$)/, /^\/manifest/, /^\/icons\//];

// Bounded, expiring storage. A cached register is useful for one
// working day; it is never a second copy of the tenant's data.
//
// The shell cache holds public, fingerprinted build assets only. It is
// capped as well: a device that stays signed in for months would
// otherwise collect every build's chunks for ever.
const MAX_CACHED_PAGES = 12;
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_SHELL_ENTRIES = 300;
const SHELL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CACHED_AT_HEADER = "x-aqua-cached-at";
const offlinePage = () => new Response(`<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to sign in</title>
<style>body{margin:0;padding:56px 24px;background:#EDF0EC;color:#0F1F1C;font:15px system-ui}
h1{font-size:22px}p{max-width:44ch;color:#3C534F;line-height:1.6}button{min-height:48px;padding:0 24px;
border:0;border-radius:9999px;background:#B84E00;color:white;font-size:16px}</style>
<h1>This register is not available offline</h1><p>Connect and sign in to download the current register.
Offline copies are available only for your active session.</p><button onclick="location.reload()">Try again</button></html>`,
{ headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const privateName = identity => `aqua-private-v2-${identity.scope}`;

async function state() {
  const response = await (await caches.open(META)).match(META_KEY);
  return response ? response.json() : {};
}
async function saveState(value) { await (await caches.open(META)).put(META_KEY, new Response(JSON.stringify(value))); }
function valid(identity) { return identity && /^[a-f0-9]{64}$/.test(identity.scope) &&
  Number.isSafeInteger(identity.expiresAt) && identity.expiresAt > Date.now(); }
async function clearPages() {
  await Promise.all((await caches.keys()).filter(name => name.startsWith("aqua-private-") || name === SHELL)
    .map(name => caches.delete(name)));
}
async function clearRecords(expectedScope) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open("aqua-offline", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("queue")) request.result.createObjectStore("queue", { keyPath: "clientId" });
      if (!request.result.objectStoreNames.contains("kv")) request.result.createObjectStore("kv");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(["queue", "kv"], "readwrite"), kv = tx.objectStore("kv");
      const identity = kv.get("identity");
      identity.onsuccess = () => {
        const previous = identity.result;
        if (expectedScope !== undefined && previous?.active && previous.active.scope !== expectedScope) return;
        tx.objectStore("queue").clear(); kv.clear();
        const blockedScope = previous?.active?.scope ?? previous?.blockedScope;
        if (blockedScope) kv.put({ blockedScope }, "identity");
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
async function clear(expectedScope) {
  return mutateCaches(async () => {
  const previous = await state();
  if (expectedScope !== undefined && previous.identity && previous.identity.scope !== expectedScope) return;
  generation++;
  await saveState({ blockedScope: previous.identity?.scope ?? previous.blockedScope });
  if (expectedScope === undefined) await clearPages();
  else { if (expectedScope) await caches.delete(`aqua-private-v2-${expectedScope}`); await caches.delete(SHELL); }
  await clearRecords(expectedScope);
  for (const client of await self.clients.matchAll()) client.postMessage({ type: "aqua-offline-cleared", scope: previous.identity?.scope });
  });
}
async function refreshIdentity() {
  const current = ++generation, previous = await state();
  if (previous.identity && !valid(previous.identity)) await clear();
  try {
    const response = await fetch("/api/offline/session", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("Session check unavailable");
    const fresh = await response.json();
    if (current !== generation) return null;
    if (!fresh.authenticated || !valid(fresh.identity)) { await clear(previous.identity?.scope ?? null); return null; }
    return await mutateCaches(async () => {
      if (current !== generation) return null;
      const stored = await state();
      if (stored.blockedScope === fresh.identity.scope) return null;
      if (stored.identity?.scope !== fresh.identity.scope) {
        await clearPages();
      }
      await saveState({ identity: fresh.identity });
      return fresh.identity;
    });
  } catch {
    const cached = await state();
    return valid(cached.identity) && cached.blockedScope !== cached.identity.scope ? cached.identity : null;
  }
}
async function cachePage(request, response, identity) {
  if (!identity || !response.ok || !response.headers.get("Content-Type")?.includes("text/html")) return;
  // A prefetched HTML document may refer to chunks the current page has not
  // requested yet. Cache its public dependencies before making it available
  // offline, so a warmed account page can hydrate its logout controls.
  const html = await response.clone().text(), shell = await caches.open(SHELL);
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(match[1].replace(/&amp;/g, "&"), self.location.origin);
    if (url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || /\.woff2?$/.test(url.pathname))) assets.add(url.href);
  }
  for (const asset of assets) {
    if (await shell.match(asset, { ignoreSearch: true })) continue;
    const dependency = await fetch(asset);
    if (!dependency.ok) return;
    await shell.put(asset, stamped(dependency, Date.now()));
  }
  // Verify the cookie/session did not change while HTML was being fetched.
  const current = await refreshIdentity();
  const authorizedGeneration = generation;
  if (current?.scope === identity.scope) await mutateCaches(async () => {
    const latest = await state();
    if (generation !== authorizedGeneration || latest.identity?.scope !== current.scope || !valid(latest.identity)) {
      return;
    }
    const cache = await caches.open(privateName(current));
    await cache.put(request, stamped(response.clone(), Date.now()));
    await prunePages(cache);
  });
}

// Every cached page carries the moment it was stored, so the worker can
// expire it instead of serving a stale register for ever.
function stamped(response, at) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(at));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function prunePages(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CACHED_PAGES))) await cache.delete(key);
}

// The cached page, if it is still inside the offline window.
async function freshPage(cache, request) {
  const hit = await cache.match(request, { ignoreVary: true });
  if (!hit) return null;
  const at = Number(hit.headers.get(CACHED_AT_HEADER));
  if (!Number.isFinite(at) || Date.now() - at > CACHE_MAX_AGE_MS) { await cache.delete(request); return null; }
  return hit;
}

// Drop pages that outlived the window when a new worker version takes
// over — the previous version may have stored them without a timestamp.
async function pruneExpiredPages() {
  for (const name of await caches.keys()) {
    if (!name.startsWith("aqua-private-")) continue;
    const cache = await caches.open(name);
    for (const key of await cache.keys()) {
      const hit = await cache.match(key, { ignoreVary: true });
      const at = Number(hit?.headers.get(CACHED_AT_HEADER));
      if (!hit || !Number.isFinite(at) || Date.now() - at > CACHE_MAX_AGE_MS) await cache.delete(key);
    }
  }
}

// The shell cache holds public build assets. Build leftovers are useless
// after a while and must not pile up, but a live asset is never evicted
// while a cached page could still need it — so old entries go first and
// only then the hard cap applies.
async function pruneShell() {
  const cache = await caches.open(SHELL);
  const keys = await cache.keys();
  const now = Date.now();
  const alive = [];
  for (const key of keys) {
    const hit = await cache.match(key, { ignoreSearch: true });
    const at = Number(hit?.headers.get(CACHED_AT_HEADER));
    if (!hit || !Number.isFinite(at) || now - at > SHELL_MAX_AGE_MS) await cache.delete(key);
    else alive.push(key);
  }
  for (const key of alive.slice(0, Math.max(0, alive.length - MAX_SHELL_ENTRIES))) await cache.delete(key);
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    await caches.open(META);
    // A FIRST install has no worker to displace, so it may take over at
    // once. An UPDATE must wait: taking over would swap the worker
    // under a page that may hold unsaved input or queued attendance.
    // The page asks for the handover (see the "aqua-activate-update"
    // message) only after it has checked that nothing would be lost.
    if (!self.registration.active) await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => { event.waitUntil((async () => {
  // The PREVIOUS version's shell cache — the literal name is
  // deliberately the old one: this is the one-time cleanup that removes
  // the cache a v1 worker left behind. The live cache is SHELL and is
  // pruned below, not deleted.
  await caches.delete("aqua-shell-v1"); await pruneExpiredPages(); await pruneShell(); await self.clients.claim();
})()); });
self.addEventListener("message", event => {
  if (event.data?.type === "aqua-activate-update") {
    event.waitUntil(self.skipWaiting().catch(() => {}));
    return;
  }
  if (event.data?.type === "aqua-clear-offline") event.waitUntil(clear(event.data.scope)
    .finally(() => event.ports[0]?.postMessage({ done: true })));
  if (event.data?.type === "aqua-refresh-offline") event.waitUntil((async () => {
    const identity = await refreshIdentity(), client = event.source;
    if (identity) await self.clients.claim();
    if (identity && client?.url && new URL(client.url).pathname.startsWith("/coach")) {
      const request = new Request(client.url, { credentials: "same-origin", headers: { Accept: "text/html" } });
      const response = await fetch(request);
      await cachePage(request, response, identity);
    }
  })().catch(() => {}));
});
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === "POST" && ["/api/login/pin", "/api/login-link/redeem"].includes(url.pathname)) {
    event.respondWith((async () => {
      const previous = await state();
      const response = await fetch(request);
      if (response.ok) { generation++; await clear(previous.identity?.scope ?? null); }
      return response;
    })()); return;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/sign-out") {
    event.respondWith((async () => { await clear(); return fetch(request); })()); return;
  }
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (NEVER_CACHED.some(pattern => pattern.test(url.pathname))) return;
  if (request.mode === "navigate" && OFFLINE_NAVIGATION.test(url.pathname)) {
    event.respondWith((async () => {
      const identity = await refreshIdentity();
      try {
        const response = await fetch(request);
        event.waitUntil(cachePage(request, response.clone(), identity));
        return response;
      } catch {
        // This cache contains only full HTML, partitioned by authenticated
        // scope and exact URL. Transport/RSC Vary headers must not prevent a
        // prefetched document matching a real offline navigation.
        const cache = identity ? await caches.open(privateName(identity)) : null;
        return (cache ? await freshPage(cache, request) : null) ?? offlinePage();
      }
    })()); return;
  }
  // Public fingerprinted shell assets only, never authenticated images/HTML.
  if (url.pathname.startsWith("/_next/static/") || /\.woff2?$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL), hit = await cache.match(request, { ignoreSearch: true });
      try { const response = await fetch(request); if (response.ok) {
        event.waitUntil((async () => {
          await cache.put(request, stamped(response.clone(), Date.now()));
          if ((await cache.keys()).length > MAX_SHELL_ENTRIES) await pruneShell();
        })());
      } return response; }
      catch { return hit ?? Response.error(); }
    })());
  }
});
