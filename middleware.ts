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
  "/api/auth/",
  "/api/health",
  // Next.js internals and static assets. Required for HMR, RSC
  // payloads, and the _next/static directory the build emits.
  "/_next/",
  "/favicon",
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

export function middleware(request: NextRequest): NextResponse {
  const host = request.headers.get("host");
  const pathname = request.nextUrl.pathname;
  const surface = classifyHost(host);

  if (surface === "unknown") {
    // No Host header at all, or a host we don't recognise. The
    // production reverse proxy always sets Host; the absence of
    // it means a misconfigured client. Fail closed.
    return new NextResponse("not found", { status: 404 });
  }

  const allowlist = surface === "ops" ? OPS_ALLOWLIST : APEX_ALLOWLIST;
  if (isAllowed(pathname, allowlist)) {
    return NextResponse.next();
  }
  return new NextResponse("not found", { status: 404 });
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
