import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";
import {
  hasCredentialByBaUserId,
  pinSchema,
  setCredential,
} from "@/lib/services/credentials";

// POST /api/account/set-pin — session-gated safety net for the
// first-login flow (2026-09-11 auth feature).
//
// The normal path sets the PIN during magic-link redemption. This
// route exists for the window where that did not happen: the user
// redeemed the link, holds a session, but closed the set-PIN screen
// (or the credential write failed). It only ever SETS a missing
// credential — an existing PIN is never changed here; that goes
// through an ops-issued owner reset link. A 409 makes the refusal
// explicit instead of silently rotating a credential from an ambient
// session.
//
// Route handler, not a Server Action: same Set-Cookie reasoning as
// the other auth routes, and a session cookie is the credential it
// checks against.
const setPinSchema = z.object({ pin: pinSchema });

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ kind: "error", code: "invalid_request" }, { status: 400 });
  }
  const parsed = setPinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ kind: "error", code: "invalid_request" }, { status: 400 });
  }

  // Session lookup through better-auth; wrapped in withPlatform for
  // the same reason as every other better-auth call site.
  const session = await withPlatform(async () =>
    auth.api.getSession({ headers: request.headers }),
  );
  if (!session?.user) {
    return NextResponse.json({ kind: "error", code: "unauthenticated" }, { status: 401 });
  }

  if (await hasCredentialByBaUserId(session.user.id)) {
    return NextResponse.json({ kind: "error", code: "already_set" }, { status: 409 });
  }

  await setCredential(session.user.id, parsed.data.pin);
  return NextResponse.json({ kind: "ok" });
}
