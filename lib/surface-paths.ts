// Which paths each surface serves.
//
// One source of truth, with two callers:
//
//   * middleware.ts — the routing layer, which refuses (404) anything
//     the host's surface does not serve. That refusal IS the host
//     boundary.
//   * lib/root-route.ts — the bare-domain entry point, which may only
//     redirect a visitor to a path its OWN surface actually serves. A
//     role whose home_path was customised to a path the apex does not
//     serve must not leave the visitor on a 404.
//
// The lists are prefixes: "/owner" serves "/owner" and "/owner/…",
// and a prefix that ends in "/" also serves the path without the
// trailing slash ("/p/" serves "/p"). The bare domain "/" is the one
// EXACT entry — it is an entry point, never a subtree. See isAllowed.

// Paths the apex always serves, regardless of auth state.
export const APEX_ALLOWLIST = [
  // The bare domain. It is an ENTRY POINT on both surfaces, not a
  // subtree: app/route.ts reads the Host header and sends the visitor
  // to that surface's own door. Matched exactly — see isAllowed.
  "/",
  "/login",
  "/owner",
  "/coach",
  "/reception",
  // R08 (2026-10-13 role-workflow audit) — the worker self-service
  // home. Exact + subtree only: "/worker" does not expose
  // "/workersomething" because isAllowed matches equality or the
  // prefix followed by "/".
  "/worker",
  "/parent",
  "/p/",
  // V-25 — the premises QR the staff scan. It is a tenant surface
  // (the scan can come from any staff phone) and authorises via the
  // session + staff.self inside the page, not via the host; the
  // middleware only lets it reach the app.
  "/check-in/",
  "/api/auth/",
  // Staff magic-link redeem (app/api/login-link/redeem). Pre-auth
  // by definition -- the token IS the credential -- same as /login
  // and /p/ above. Authorization lives in redeemLoginLink
  // (signature + expiry + membership status + single-use consume).
  "/api/login-link/",
  // Phone + PIN login (2026-09-11 auth feature). Pre-auth by
  // definition; every failure is a generic 401.
  "/api/login/",
  "/api/offline/",
  // Session-gated set-PIN safety net (already-authenticated users
  // only; the route checks the better-auth session itself).
  "/api/account/",
  // Set-PIN screen reached when a redeem happens without a PIN (the
  // session exists but no credential does). The page redirects to
  // /login when there is no session.
  "/set-pin",
  // C-35 — uploaded payment-QR images. Session-gated: the route
  // handler resolves the tenant context and refuses without
  // settings.read, so the middleware only needs to let it reach the
  // app.
  "/api/payment-qr/",
  // C-39 — payment receipt PDFs. Session-gated: the route handler
  // resolves the tenant context and refuses without invoices.read,
  // so the middleware only needs to let it reach the app.
  "/api/receipts/",
  "/api/health",
  // Next.js internals and static assets. Required for HMR, RSC
  // payloads, and the _next/static directory the build emits.
  "/_next/",
  "/favicon",
  // The App Router metadata icon (app/icon.svg). It is referenced by
  // the root layout's <link rel="icon">, so the browser requests it on
  // every surface — including ops — and it must not 404.
  "/icon.svg",
  // Service worker registration. The offline-attendance-sync
  // feature registers `/sw.js` (see components/sw-registrar.tsx);
  // if the middleware blocks /sw.js the SW never registers and
  // the offline-sync e2e (scripts/e2e-offline.ts) breaks because
  // the page can't load from cache while offline. The SW is at the
  // root of the apex host (tenant surface), not on ops.
  "/sw.js",
  // The installable tenant app (PWA): its web app manifest and its
  // icons. Both are public, same-origin, static assets — the manifest
  // carries no identity (its start_url is the bare entry point, which
  // resolves to the caller's own role home) and the icons are the
  // platform's artwork. Without these two entries the browser gets a
  // 404 for the manifest and the app can never be installed.
  //
  // They are admitted on the APEX ONLY: the operator console is not
  // an installable app and must never receive install metadata. That
  // asymmetry is the same mechanism that keeps /sw.js off ops, and
  // scripts/e2e-host-boundary.ts pins both sides of it.
  //
  // The files themselves are declared in lib/offline/pwa-manifest.ts
  // and pinned against this list by tests/pwa/manifest.test.ts, so the
  // route and the manifest cannot drift apart.
  //
  // "/icons/" is PLATFORM ARTWORK ONLY. A tenant-uploaded logo must
  // never be written under it: this prefix is public, unauthenticated
  // and unversioned. Tenant assets belong behind an authorised route.
  "/manifest.webmanifest",
  "/icons/",
] as const;

// Paths the ops host always serves.
export const OPS_ALLOWLIST = [
  // The bare domain on the platform host opens the platform app. It
  // is matched exactly, like the apex entry point above.
  "/",
  "/ops",
  // "/api/auth/" is deliberately NOT served here. The platform surface
  // authenticates with its own platform_session cookie and has no
  // better-auth identity, so admitting the tenant's better-auth surface
  // let a TENANT session token — transmitted by hand rather than by a
  // browser, which never sends it here — be honoured on the platform
  // host. The tenant apex still serves it; that is where the phone+PIN
  // and magic-link flows live.
  "/api/health",
  "/_next/",
  "/favicon",
  // app/icon.svg is linked from the shared root layout, so it is
  // requested here too; see the APEX_ALLOWLIST comment.
  "/icon.svg",
] as const;

export type Surface = "apex" | "ops";

export function allowlistFor(surface: Surface): readonly string[] {
  return surface === "ops" ? OPS_ALLOWLIST : APEX_ALLOWLIST;
}

/**
 * Is this path one the given surface serves?
 *
 * The bare domain is an EXACT entry point, never a subtree. Every
 * other entry is a prefix, and a prefix that ends in "/" means "this
 * path and everything under it" — so "/" here would match every path
 * on the host and open the whole surface. The root is matched
 * literally instead.
 */
export function isAllowed(pathname: string, allowlist: readonly string[]): boolean {
  for (const prefix of allowlist) {
    if (prefix === "/") {
      if (pathname === "/") return true;
      continue;
    }
    if (prefix.endsWith("/")) {
      if (pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)) return true;
    } else if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return true;
    }
  }
  return false;
}

/** Is this path served by the given surface? */
export function isServedBySurface(pathname: string, surface: Surface): boolean {
  return isAllowed(pathname, allowlistFor(surface));
}
