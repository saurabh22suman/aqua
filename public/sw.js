const CACHE = "aqua-shell-v1";
const SHELL_PATTERNS = [/\/_next\/static\//, /\/_next\/image\?/, /\.woff2?(\?.*)?$/];

// Rule 1 — fail loud, never silent. A cache MISS on an offline navigation
// (the coach's first-ever visit to this exact page with no signal) would
// otherwise fall through to Response.error(), which the browser renders as
// its own generic "can't reach this page" screen — not wrong, but not an
// answer either, and not something Rule 1 accepts as good enough. This is
// a hand-written HTML string, not a Next.js page, on purpose: if the
// network fetch has already failed, there is no server left to render
// anything, and no cached JS bundle to hydrate a React error boundary with
// — the service worker is the only thing left that can respond at all.
const OFFLINE_NOT_DOWNLOADED_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not downloaded yet</title>
<style>
  body { margin:0; padding:56px 24px; background:#EDF0EC; color:#0F1F1C;
         font-family:system-ui,-apple-system,sans-serif; }
  h1 { font-size:19px; font-weight:600; margin:0 0 10px; }
  p { font-size:14px; color:#3C534F; line-height:1.55; margin:0 0 28px; max-width:44ch; }
  button { height:48px; padding:0 22px; border:0; border-radius:9999px;
           background:#FF7A18; color:#fff; font-size:15px; font-weight:600; }
</style></head>
<body>
  <h1>This page hasn't been downloaded yet</h1>
  <p>You're offline, and this is the first time this device has tried to open it — there's nothing saved here to show. Connect once, open it, then it'll keep working offline after that.</p>
  <button onclick="location.reload()">Try again</button>
</body></html>`;

function offlineNotDownloadedResponse() {
  return new Response(OFFLINE_NOT_DOWNLOADED_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

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
        .catch(() =>
          caches.match(request).then((hit) => hit ?? offlineNotDownloadedResponse()),
        ),
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
