import { NextResponse, type NextRequest } from "next/server";
import { isOpsHost } from "@/lib/ops-host";
import { APEX_ALLOWLIST, OPS_ALLOWLIST, isAllowed } from "@/lib/surface-paths";

// Host-based route-group gating. Two rules:
//
//   1. the platform host (OPS_HOST, e.g.
//      aquaops.preprabbit.in) — serves ONLY /ops/*. Anything else
//      404s.
//   2. the tenant apex (e.g. aqua.preprabbit.in) — serves tenant
//      surfaces, /login, /p/*, /api/auth/*, /api/health, and Next's
//      own _next/* and asset routes. /ops/* 404s.
//
// The bare domain ("/") is the one path BOTH hosts serve: it is the
// entry point, and app/route.ts sends the visitor to that host's own
// door (the tenant sign-in or home on the apex, the platform overview
// on the ops host). It is matched exactly, never as a subtree.
//
// Which paths each surface serves lives in lib/surface-paths.ts — the
// bare-domain entry point checks it too, so a redirect can never point
// at a path its own host does not serve.
//
// The boundary is mechanical — neither host can serve the other's
// path prefix. Verified end-to-end by scripts/e2e-host-boundary.ts
// against a real `next dev` on an arbitrary port.
//
// Why this exists: the platform surface uses TOTP-based auth with
// its own `platform_session` cookie (lib/auth/platform-cookie.ts)
// and never touches better-auth or the tenant schema. Putting it on
// its own host narrows the cookie's reach (browsers scope
// `Set-Cookie` without an explicit `Domain=` attribute to the
// exact host that set it — `platform_session` set on the platform
// host is never sent to the tenant apex, and vice versa) and makes
// the platform-vs-tenant boundary something the routing layer
// enforces, not just the layout auth gates.
//
// Which host is the platform host is lib/ops-host.ts's decision —
// the same module the WhatsApp sign-in route uses, so the routing
// layer and the auth layer can never disagree about it.

function classifyHost(host: string | null): "ops" | "apex" | "unknown" {
  if (!host) return "unknown";
  if (isOpsHost(host)) return "ops";
  // Anything that is not the platform host is treated as apex.
  // Per-tenant subdomains (B) will extend this branch — see
  // docs/deployment.md § B.
  return "apex";
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
