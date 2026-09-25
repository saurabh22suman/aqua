import { NextResponse, type NextRequest } from "next/server";

// Host-based route-group gating. Two rules:
//
//   1. ops.<base>     — serves ONLY /ops/*. Anything else 404s.
//   2. <base> (apex)  — serves tenant surfaces, /login, /p/*, /api/auth/*,
//                        /api/health, and Next's own _next/* and asset
//                        routes. /ops/* 404s.
//
// The boundary is mechanical — neither host can serve the other's
// path prefix. Verified end-to-end by scripts/e2e-host-boundary.ts
// against a real `next dev` on an arbitrary port.
//
// Why this exists: the platform surface uses TOTP-based auth with
// its own `platform_session` cookie (lib/auth/platform-cookie.ts)
// and never touches better-auth or the tenant schema. Putting it on
// its own subdomain narrows the cookie's reach (browsers scope
// `Set-Cookie` without an explicit `Domain=` attribute to the
// exact host that set it — `platform_session` set on `ops.<base>`
// is never sent to `aquaworli.<base>`, and vice versa) and makes
// the platform-vs-tenant boundary something the routing layer
// enforces, not just the layout auth gates.

const OPS_PREFIX = "ops.";

function classifyHost(host: string | null): "ops" | "apex" | "unknown" {
  if (!host) return "unknown";
  const lower = host.toLowerCase().split(":")[0]!;
  if (lower.startsWith(OPS_PREFIX)) return "ops";
  // Anything without a subdomain, or with a subdomain we don't
  // recognise yet, is treated as apex. Per-tenant subdomains
  // (B) will extend this branch — see docs/deployment.md § B.
  return "apex";
}

// Paths the apex always serves, regardless of auth state.
const APEX_ALLOWLIST = [
  "/login",
  "/owner",
  "/coach",
  "/reception",
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
];

// Paths the ops subdomain always serves.
const OPS_ALLOWLIST = [
  "/ops",
  // /api/auth is here because better-auth's sign-in endpoints are
  // safe to expose (no better-auth state exists on the ops host
  // — there are no tenants here). The platform's actual auth lives
  // on /ops/login + /ops/verify. Keeping /api/auth available means
  // a future "sign in with phone" feature on the platform can
  // share the better-auth endpoints without a separate route.
  "/api/auth/",
  "/api/health",
  "/_next/",
  "/favicon",
  // app/icon.svg is linked from the shared root layout, so it is
  // requested here too; see the APEX_ALLOWLIST comment.
  "/icon.svg",
];

function isAllowed(pathname: string, allowlist: readonly string[]): boolean {
  for (const prefix of allowlist) {
    if (prefix.endsWith("/")) {
      if (pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)) return true;
    } else if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return true;
    }
  }
  return false;
}

// H-04 — one correlation id per request, created here, forwarded to
// the app via the request headers (so `headers().get("x-request-id")`
// and Ctx can read it) and echoed on the response (so an operator
// reading a browser network tab or an access log can join the two).
// Inbound ids are preserved — a reverse proxy or an upstream caller
// may already have one.
function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set("x-request-id", requestId);
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const host = request.headers.get("host");
  const pathname = request.nextUrl.pathname;
  const surface = classifyHost(host);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  if (surface === "unknown") {
    // No Host header at all, or a host we don't recognise. The
    // production reverse proxy always sets Host; the absence of
    // it means a misconfigured client. Fail closed.
    return withRequestId(new NextResponse("not found", { status: 404 }), requestId);
  }

  const allowlist = surface === "ops" ? OPS_ALLOWLIST : APEX_ALLOWLIST;
  if (isAllowed(pathname, allowlist)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-request-id", requestId);
    return withRequestId(
      NextResponse.next({ request: { headers: requestHeaders } }),
      requestId,
    );
  }
  return withRequestId(new NextResponse("not found", { status: 404 }), requestId);
}

// Skip static files and the favicon — Next's own matcher handles
// these, but we exclude them here so the matcher config is explicit
// and the e2e can hit /api/health without the middleware redirect
// running twice. Same shape as Next's recommended matcher.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
