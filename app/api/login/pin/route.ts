import { NextResponse } from "next/server";
import { z } from "zod";
import { pinLogin, pinSchema } from "@/lib/services/credentials";
import { FACILITY_COOKIE } from "@/lib/facility";
import { THEME_COOKIE } from "@/lib/theme/storage";

// POST /api/login/pin — the phone + PIN login door (2026-09-11 auth
// feature).
//
// A Route Handler rather than a Server Action for the same reason as
// the redeem route: the session cookie is set explicitly on this
// response, and cookies().set() inside a Server Action does not emit
// Set-Cookie on the flight response in this Next version.
//
// The response is deliberately minimal: `{kind:"ok"}` plus the
// session cookie on success, `{kind:"error", code:"invalid_credentials"}`
// with a 401 for EVERY failure (wrong PIN, unknown phone, locked
// account, internal sign-in error). Nothing distinguishes the cases
// to the caller; the lockout bookkeeping happens inside pinLogin.
const loginSchema = z.object({
  phone: z.string().trim().min(1).max(40),
  pin: pinSchema,
});

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { kind: "error", code: "invalid_request" },
      { status: 400 },
    );
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { kind: "error", code: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await pinLogin(parsed.data.phone, parsed.data.pin);
  if (result.status < 200 || result.status >= 300) {
    return NextResponse.json(
      { kind: "error", code: "invalid_credentials" },
      { status: 401 },
    );
  }

  // Success: relay every Set-Cookie from better-auth's response onto
  // our own JSON response (the client reads the body, the browser
  // keeps the cookie).
  const res = NextResponse.json({ kind: "ok" });
  // The display preferences on this device — the appearance preset and
  // the facility scope choice — belong to whoever was signed in here
  // before. A successful login starts a new session, so they are
  // dropped: the next person on a shared device starts on the default
  // preset and the tenant's default scope instead of inheriting them.
  //
  // A FAILED login never reaches this line, so a mistyped PIN cannot
  // strip the signed-in user's own choices.
  //
  // Order matters: mutating the cookie jar rewrites the whole
  // `set-cookie` header, so the deletions come first and better-auth's
  // cookies are appended afterwards — otherwise the session cookie
  // would be dropped from the response and nobody could sign in.
  res.cookies.delete(THEME_COOKIE);
  res.cookies.delete(FACILITY_COOKIE);
  for (const cookie of result.headers.getSetCookie()) {
    res.headers.append("set-cookie", cookie);
  }
  return res;
}
