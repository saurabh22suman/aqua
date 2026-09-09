import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/server";
import {
  redeemLoginLink,
  type RedeemLoginLinkError,
} from "@/lib/services/invite-link";

// POST /api/login-link/redeem — consumes a staff magic-link login
// token and signs the holder in. Pre-auth by definition (the token
// IS the credential); authorization lives in redeemLoginLink
// (signature + expiry + membership status + single-use consume).
//
// A Route Handler rather than a Server Action on purpose: the
// session cookie is set explicitly on this response, and
// cookies().set() inside a Server Action does not emit Set-Cookie
// on the flight response in this Next version (verified live:
// the action ran end to end, jar.set executed without throwing,
// the response carried no Set-Cookie). Explicit res.cookies.set
// is the boring mechanism with no framework magic in between.
const redeemSchema = z.object({
  token: z.string().min(1).max(4096),
});

export type RedeemRouteResult =
  | { kind: "ok"; homePath: string }
  | { kind: "error"; code: RedeemLoginLinkError };

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { kind: "error", code: "invalid" } satisfies RedeemRouteResult,
      { status: 400 },
    );
  }
  const parsed = redeemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { kind: "error", code: "invalid" } satisfies RedeemRouteResult,
      { status: 400 },
    );
  }

  const result = await redeemLoginLink(parsed.data.token);
  if (result.kind === "error") {
    // Generic 401 for every flavor (invalid, used, revoked,
    // suspended): the confirm page already showed a generic
    // message, and the status must not become an oracle.
    return NextResponse.json(
      { kind: "error", code: result.code } satisfies RedeemRouteResult,
      { status: 401 },
    );
  }

  // Cookie name + flags come from better-auth's own cookie factory
  // (same factory the OTP flow uses) -- never hardcoded -- except
  // sameSite, whose library union is wider (capitalized variants)
  // than ResponseCookie's and is normalised here.
  //
  // The VALUE must be signed: better-auth reads the session cookie
  // with getSignedCookie (value.signature, HMAC-SHA256 over the raw
  // token, base64, URI-encoded) and drops unsigned values before
  // any DB lookup. An unsigned cookie is a silent login failure --
  // the redeem succeeds server-side while the browser stays logged
  // out. This replicates better-call's signCookieValue exactly,
  // except the final encodeURIComponent: Next's res.cookies.set
  // encodes once itself, so passing a pre-encoded value double-
  // encodes (%2F becomes %252F) and the signature check fails.
  // Verified live with curl (jar + get-session + role page).
  const baCtx = await auth.$context;
  const attrs = baCtx.authCookies.sessionToken.attributes;
  const signature = createHmac("sha256", baCtx.secret).update(result.sessionToken).digest("base64");
  const res = NextResponse.json(
    { kind: "ok", homePath: result.homePath } satisfies RedeemRouteResult,
  );
  res.cookies.set(baCtx.authCookies.sessionToken.name, `${result.sessionToken}.${signature}`, {
    httpOnly: attrs.httpOnly,
    secure: attrs.secure,
    path: attrs.path,
    maxAge: attrs.maxAge,
    sameSite: (attrs.sameSite as string).toLowerCase() as "lax" | "strict" | "none",
  });
  return res;
}
