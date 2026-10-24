import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";
import { resolveSessionForLogin, type SessionResolution } from "@/db/platform";
import { isOpsHost } from "@/lib/ops-host";
import { rootDestinationFor } from "@/lib/root-route";

// The bare domain.
//
// Two apps, two sibling hosts: the tenant surface on the apex and the
// platform surface on the ops host. Typing the bare domain must open
// the right one — before this route existed, both hosts answered "/"
// with a 404, so the bare domain was simply broken.
//
// This is a Route Handler, not a page, on purpose. A redirect decided
// DURING RENDER (a server component calling redirect()) cannot be an
// HTTP redirect once the shell has been flushed: Next.js answers 200
// and delivers the redirect inside the RSC payload, so the visitor
// sees the page shell first and the client router finishes the hop.
// That is fine for an in-app link and wrong for an entry point — the
// bare domain is the one URL a person types, and it must answer with
// a real redirect that any client can follow.
//
// The destination is chosen by the Host header and is always a PATH,
// so the browser stays on the host it asked for: the tenant apex can
// never be sent to /ops, and the platform host can never be sent to a
// tenant page. The routing layer (middleware.ts) still owns the
// boundary — this route only decides where a visitor who typed the
// bare domain lands.
//
//   platform host -> /ops   (the overview, which gates itself on the
//                            platform session and sends an operator
//                            who is not signed in to the ops sign-in)
//   tenant apex   -> the signed-in user's own home (owner, coach,
//                            reception, worker, parent — wherever their
//                            role lands), or the sign-in screen when
//                            there is no session yet
export async function GET(request: NextRequest) {
  const host = request.headers.get("host");

  // The platform session is a different cookie (platform_session) from
  // the tenant session, and it is never sent to the tenant host. There
  // is nothing to resolve on the platform host: /ops decides for itself
  // whether to show the overview or the sign-in screen.
  const session = isOpsHost(host)
    ? ({ kind: "none" } as const)
    : await resolveTenantSession();

  const destination = rootDestinationFor(host, session);
  return NextResponse.redirect(absoluteDestination(request, destination), 307);
}

/**
 * The absolute URL of a path on the host the visitor asked for.
 *
 * Next.js does NOT build `request.url` from the request's Host header:
 * in dev it uses its own fetch hostname, and in production it leaves
 * the URL a bare path unless `experimental.trustHostHeader` is on. So
 * `new URL(path, request.url)` would send the visitor to the wrong
 * host — in production, to nothing at all.
 *
 * The Host header IS the host the visitor asked for: the reverse proxy
 * routes on it and forwards it unchanged. The scheme comes from
 * X-Forwarded-Proto, which the proxy sets (and Next defaults to the
 * socket's own scheme when the proxy does not). Only "http" and
 * "https" are accepted, so a forged header cannot turn the redirect
 * into some other scheme.
 */
function absoluteDestination(request: NextRequest, path: string): string {
  const host =
    request.headers.get("host") ??
    request.headers.get("x-forwarded-host") ??
    request.nextUrl.host;
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const scheme = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : "https";
  return `${scheme}://${host}${path}`;
}

// The tenant session's home.
//
// The platform session is a separate cookie and a separate table; the
// better-auth session is the tenant one. This mirrors what
// homeForSessionAction does for the login form (same lookup, same
// resolution) so the bare domain and the sign-in flow agree on where a
// signed-in user belongs.
async function resolveTenantSession(): Promise<SessionResolution> {
  const h = await headers();
  const session = await withPlatform(() => auth.api.getSession({ headers: h }));
  if (!session?.user) return { kind: "none" };
  return resolveSessionForLogin(session.user.id);
}
