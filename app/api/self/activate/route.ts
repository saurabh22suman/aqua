// POSTIMAGE — app/api/self/activate/route.ts  (candidate, NOT applied)
//
// POST /api/self/activate — the ONE activation door: the member (or the
// guardian) redeems the one-time activation link the club handed them
// AND proves the PIN in the same request.
//
// It is a Route Handler rather than a Server Action, for the repository's
// own recorded reason: the session cookie is set explicitly on this
// response, and cookies().set() inside a Server Action does not emit
// Set-Cookie on the flight response in this Next version
// (app/api/login/pin/route.ts).
//
// EVERY REFUSAL IS THE SAME GENERIC 401 — byte-identical for "no such
// token", "already spent", "not an invitation any more", "wrong PIN",
// "this account is a staff account with no PIN" and "a foreign origin".
// The response never distinguishes them, and it never carries a token, a
// PIN or a phone number.
//
// THE ORIGIN CHECK IS THE REPOSITORY'S OWN SHAPE (the self PIN door's
// shape): the request's origin host must equal the request's host, and in
// production the origin protocol must be https. A request with NO origin
// is refused too — a header-less call is not a browser.
//
// IT NEVER CALLS auth.api.signInEmail OR auth.api.signOut AND NEVER
// WRITES A ba_session ROW. The only credential this response sets is the
// purpose-scoped self-service cookie.
//
// NO SMS AND NO OTP. This door never sends or verifies a message code.

import { NextResponse } from "next/server";
import { z } from "zod";
import { pinSchema } from "@/lib/services/credentials";
import { withTenant } from "@/db/tenant";
import { asTenantId, asUserId } from "@/lib/ids";
import { readSelfServiceAccountInTx } from "@/db/self-service-account";
import { isPinLocked, recordPinFailure, clearPinFailures } from "@/lib/services/pin-lockout";
import { consumeSelfServiceBudgetInTx } from "@/lib/services/self-service-throttle";
import { verifySelfServiceToken } from "@/lib/services/self-service-token";
import { activateSelfServiceAccount } from "@/lib/services/self-service-activation";
import {
  SELF_SERVICE_COOKIE,
  SELF_SERVICE_SESSION_TTL_SECONDS,
  selfServiceCookieOptions,
} from "@/lib/services/self-service-session";

const activateSchema = z.object({
  token: z.string().min(1).max(4096),
  // The PIN is REQUIRED, and it means different things for different
  // accounts: for an account that already has a credential it is the
  // credential's own PIN and it is verified; for an account with none it
  // is the first credential and it is created. It is never a reset.
  pin: pinSchema,
});

type ActivateResult =
  | { kind: "ok"; homePath: string; audience: "member" | "guardian" }
  | { kind: "error"; code: "invalid_request" | "invalid_credentials" };

function genericFailure(): NextResponse {
  return NextResponse.json(
    { kind: "error", code: "invalid_credentials" } satisfies ActivateResult,
    { status: 401 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!originAllowed(request)) return genericFailure();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { kind: "error", code: "invalid_request" } satisfies ActivateResult,
      { status: 400 },
    );
  }
  const parsed = activateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { kind: "error", code: "invalid_request" } satisfies ActivateResult,
      { status: 400 },
    );
  }

  // 1. THE TOKEN. A malformed, tampered, expired or wrongly-signed token
  //    is refused with the same answer as every other failure.
  const claims = verifySelfServiceToken(parsed.data.token);
  if (!claims) return genericFailure();
  if (claims.linkIds.length !== 1) return genericFailure();

  // Failed authentication must retain its attempt budget. Keep this short
  // security-bookkeeping transaction separate from atomic enrollment writes.
  let admitted: boolean;
  try {
    admitted = await withTenant(asTenantId(claims.tenantId), async (tx) => {
      const account = await readSelfServiceAccountInTx(tx, {
        tenantId: asTenantId(claims.tenantId), userId: asUserId(claims.userId),
      });
      if (!account || isPinLocked(account.pinLockedUntil)) return false;
      return consumeSelfServiceBudgetInTx(tx, {
        tenantId: asTenantId(claims.tenantId), userId: asUserId(claims.userId),
        address: account.phone,
      });
    });
  } catch {
    return genericFailure();
  }
  if (!admitted) return genericFailure();

  // 2. THE ACTIVATION. One transaction: the identity, the credential, the
  //    link flip, the single-use consume, the scoped session and every
  //    audit row — or none of them. An unexpected failure is the same
  //    generic answer.
  let outcome;
  try {
    outcome = await activateSelfServiceAccount({
      claims,
      pin: parsed.data.pin,
    });
  } catch {
    return genericFailure();
  }
  if (outcome.kind === "error") {
    if (outcome.code === "pin_mismatch") {
      // The durable per-club budget is already spent even if bookkeeping fails.
      await recordPinFailure(asUserId(claims.userId)).catch(() => {});
    }
    return genericFailure();
  }
  // Enrollment has committed. A counter-clear failure cannot strand its cookie.
  await clearPinFailures(asUserId(claims.userId)).catch(() => {});

  // 3. THE COOKIE. Host-only, httpOnly, lax — the scoped session, never
  //    a better-auth session.
  const res = NextResponse.json({
    kind: "ok",
    homePath: outcome.audience === "member" ? "/member" : "/family",
    audience: outcome.audience,
  } satisfies ActivateResult);
  res.cookies.set(
    SELF_SERVICE_COOKIE,
    outcome.cookieValue,
    selfServiceCookieOptions(SELF_SERVICE_SESSION_TTL_SECONDS),
  );
  return res;
}

/**
 * The origin check, in the repository's own shape
 * (app/api/self/login/pin/route.ts).
 *
 * The repository's shape ALSO carries a third clause — the ops-host
 * clause — which is DELIBERATELY OMITTED here: this is an APEX-ONLY
 * surface, and the host-equality check already refuses a foreign origin.
 */
function originAllowed(request: Request): boolean {
  const host = request.headers.get("host")?.toLowerCase();
  if (!host) return false;
  let origin: URL;
  try {
    origin = new URL(request.headers.get("origin") ?? "");
  } catch {
    return false;
  }
  return (
    origin.host.toLowerCase() === host &&
    (process.env.NODE_ENV !== "production" || origin.protocol === "https:")
  );
}
