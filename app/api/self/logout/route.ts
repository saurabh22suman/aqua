// POSTIMAGE — app/api/self/logout/route.ts  (candidate, NOT applied)
//
// POST /api/self/logout — ends the member/guardian scoped session.
//
// It revokes the scoped session row and clears the scoped cookie.
//
// It must NOT call auth.api.signOut: the staff session is a SEPARATE
// credential, and ending the member session must not end the staff one.
// The mirror case -- the STAFF sign-out also clearing the scoped session
// on a shared device -- is a separate decision and lives in another
// route.
//
// It is COOKIE-AUTHENTICATED and STATE-CHANGING, so it carries the
// explicit origin check of the repository's own shape
// (lib/auth/whatsapp-route.ts).
//
// IDEMPOTENT: no scoped session present is still 200 { kind: "ok" }.

import { NextResponse } from "next/server";
import {
  SELF_SERVICE_COOKIE,
  revokeSelfServiceSession,
  selfServiceCookieOptions,
} from "@/lib/services/self-service-session";
import { readScopedSession } from "@/lib/auth/self-scope";

export async function POST(request: Request): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return NextResponse.json(
      { kind: "error", code: "forbidden_origin" },
      { status: 403 },
    );
  }

  // The row is read in ANY state, not only a live one: a session that
  // has expired but was never revoked should still be marked revoked
  // rather than left live-but-dead.
  const found = await readScopedSession();
  if (found?.session) {
    // THE ACTOR IS NEVER NULL. The session table's CHECK
    // (revoked_at is null or revoked_by_user_id is not null) requires a
    // revocation to name its actor, and the actor here is the account
    // that OWNS the session.
    await revokeSelfServiceSession({
      tenantId: found.session.tenantId,
      sessionId: found.session.id,
      revokedByUserId: found.session.userId,
    });
  }

  // The cookie is cleared EXPLICITLY on this response.
  const res = NextResponse.json({ kind: "ok" });
  res.cookies.set(SELF_SERVICE_COOKIE, "", selfServiceCookieOptions(0));
  return res;
}

// The origin check, in the repository's own shape
// (lib/auth/whatsapp-route.ts): the request's origin host must equal the
// request's host, and in production the origin protocol must be https.
//
// The repository's shape ALSO carries a third clause --
// `((purpose === "ops_login") !== isOpsHost(host))` -- which refuses a
// request whose purpose does not match the host. It is DELIBERATELY
// OMITTED here: this is an APEX-ONLY surface. The self surface is not
// served by the ops host at all (the ops allowlist has no /api/self/
// entry -- see lib/surface-paths.ts), so the ops-host clause has no
// meaning for this route, and the host-equality check already refuses a
// foreign origin.
function originAllowed(request: Request): boolean {
  const host = request.headers.get("host")?.toLowerCase();
  if (!host) return false;
  let origin: URL;
  try {
    origin = new URL(request.headers.get("origin") ?? "");
  } catch {
    return false;
  }
  if (origin.host.toLowerCase() !== host) return false;
  if (
    process.env.NODE_ENV === "production" &&
    origin.protocol !== "https:"
  ) {
    return false;
  }
  return true;
}
