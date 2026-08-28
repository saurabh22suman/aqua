const CACHE = "aqua-shell-v1";
const SHELL_PATTERNS = [/\/_next\/static\//, /\/_next\/image\?/, /\.woff2?(\?.*)?$/];

// Allowlist, not a denylist, on purpose: this is what needs to work
// offline THIS WEEK — the coach's register flow. /login so the shell is
// reachable at all after a session expiry. Everything else (owner,
// parent, and — critically — a future /p/[token] magic-link route) is
// deliberately left uncached. An allowlist can't accidentally start
// caching a new route just because someone forgot to add it to an
// exclusion list; a denylist could. /p/[token] must stay zero-JS and
// uncached — do not add it here without re-reading why.
const CACHEABLE_NAV_PATTERNS = [/^\/coach(\/|$)/, /^\/login$/];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const isCacheableNav =
    request.mode === "navigate" &&
    CACHEABLE_NAV_PATTERNS.some((p) => p.test(url.pathname));
  const isShell = isCacheableNav || SHELL_PATTERNS.some((p) => p.test(url.pathname));
  if (!isShell) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? network;
    }),
  );
});
