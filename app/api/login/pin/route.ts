import { NextResponse } from "next/server";
import { z } from "zod";
import { pinLogin, pinSchema } from "@/lib/services/credentials";

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
  for (const cookie of result.headers.getSetCookie()) {
    res.headers.append("set-cookie", cookie);
  }
  return res;
}
