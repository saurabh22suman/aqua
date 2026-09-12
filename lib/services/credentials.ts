// @vitest-environment node
//
// 2026-09-11 auth feature — credentials service.
//
// The phone+PIN login delegates identity to better-auth. The ba_user
// row already exists (the phone OTP plugin created it with a temp
// email `${phone}@phone.aqua.local`); the credential slot
// (ba_account.password, providerId='credential') is what this service
// fills. Every call goes through withPlatform() — users and ba_user /
// ba_account are platform tables (no RLS, see db/CLAUDE.md).
//
// Why not call better-auth's HTTP endpoints for everything: the
// lockout state lives on our users row (a counter + a timestamp),
// and the better-auth endpoints don't know about it. Pre-check + sign-in
// + post-fail bookkeeping is the part this service owns. The set-PIN
// path uses better-auth's own internal adapter helpers (the same ones
// `auth.api.setPassword` is built on) so the hash format stays
// canonical even if better-auth switches the default algorithm.
//
// Rate limiting is intentionally out of scope here: better-auth has
// its own per-IP rate limiter (rateLimit config in lib/auth/server.ts).
// The per-account lockout in this service is the second layer.

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import { db } from "@/db/auth-db";
import { withPlatform } from "@/db/scope";
import { auth } from "@/lib/auth/server";
import { findOrCreateUserByPhone } from "@/db/user-account";
import { users } from "@/db/schema/users";
import { baUser, baAccount } from "@/db/schema/better-auth";
import { asUserId } from "@/lib/ids";
import { normaliseToE164 } from "@/lib/phone";

// The PIN shape: 6-12 digits. Digits-only is the product decision
// (mobile keypad, quick to enter); 6 is the minimum better-auth is
// configured to accept (minPasswordLength) and the lockout in this
// module is what makes 6 acceptable. Routes reuse this schema so the
// boundary and the service agree; redeeming a login link validates
// against it BEFORE consuming the single-use link.
export const pinSchema = z.string().regex(/^\d{6,12}$/);

// The lockout policy lives in ./pin-lockout (kept small).
import { clearPinFailures, isPinLocked, recordPinFailure } from "./pin-lockout";
export { PIN_LOCKOUT_THRESHOLD, PIN_LOCKOUT_WINDOW_MS } from "./pin-lockout";


// better-auth's account issuer for locally-managed credentials:
// createLocalAccountIssuer("credential") === `local:${encodeURIComponent("credential")}`.
// Not exported from better-auth's public API, so it is pinned here
// (and in the migration test) rather than imported from a deep path.
// findCredentialAccount filters on it, so every credential row this
// service writes must carry it or sign-in will not find the account.
const CREDENTIAL_ISSUER = "local:credential";

// Generic failure body. Identical for "wrong pin", "locked",
// "unknown phone" — no oracle for which case fired.
const GENERIC_LOGIN_FAILURE = JSON.stringify({
  kind: "error",
  code: "invalid_credentials",
});

function genericFailure(): Response {
  return new NextResponse(GENERIC_LOGIN_FAILURE, {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

// Used by the set-PIN flow on first magic-link redeem AND by the
// owner-only reset flow. Idempotent: overwrites an existing credential
// (the reset path's whole reason for existing). Caller is responsible
// for ensuring the membership role permits this (issueOwnerResetLink
// gates on roles.key === 'owner'; the redeem route re-checks).
export async function setCredential(
  baUserId: string,
  pin: string,
): Promise<void> {
  // Pin shape is validated at the HTTP boundary (Zod). The service
  // assumes valid input — no re-validation, no defensive strings —
  // because callers that go around the boundary (seed scripts,
  // future internal flows) are trusted.
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(pin);
  await withPlatform(async () => {
    const existing = await ctx.internalAdapter.findCredentialAccount(baUserId);
    if (!existing) {
      await ctx.internalAdapter.linkAccount({
        userId: baUserId,
        providerId: "credential",
        issuer: CREDENTIAL_ISSUER,
        accountId: baUserId,
        password: hash,
      });
      return;
    }
    // Overwrite: updateAccount sets the password on the existing
    // credential row (better-auth's own setPassword does the same when
    // an account exists but has no password yet — here we go a step
    // further and always overwrite, because reset must replace an
    // existing PIN).
    await ctx.internalAdapter.updateAccount(existing.id, { password: hash });
  });
}

// Ensures the users row and the better-auth ba_user row exist for a
// canonical phone, links them, and returns the ba_user id. This is
// the identity half of magic-link redemption, extracted so the demo
// seeding path (setCredentialForPhone) cannot drift from it.
export async function ensureBaUserForPhone(rawPhone: string): Promise<string> {
  const phone = normaliseToE164(rawPhone);
  return withPlatform(async () => {
    const user = await findOrCreateUserByPhone(phone);
    const userId = asUserId(user.id);
    const tempEmail = `${phone}@phone.aqua.local`;
    const existing = await db
      .select({ id: baUser.id })
      .from(baUser)
      .where(eq(baUser.phoneNumber, phone))
      .limit(1);
    let baUserId: string;
    if (existing[0]) {
      baUserId = existing[0].id;
    } else {
      const inserted = await db
        .insert(baUser)
        .values({
          id: uuidv7(),
          name: phone,
          email: tempEmail,
          phoneNumber: phone,
          phoneNumberVerified: true,
        })
        .onConflictDoNothing({ target: baUser.email })
        .returning({ id: baUser.id });
      if (inserted[0]) {
        baUserId = inserted[0].id;
      } else {
        const retry = await db
          .select({ id: baUser.id })
          .from(baUser)
          .where(eq(baUser.email, tempEmail))
          .limit(1);
        baUserId = retry[0]!.id;
      }
    }
    await db
      .update(users)
      .set({ betterAuthId: baUserId, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return baUserId;
  });
}

// Phone-keyed set. Used by demo seeding (scripts/lib/demo-credentials)
// and any future bootstrap that needs a working credential without a
// magic link. Overwrites an existing credential, like setCredential.
export async function setCredentialForPhone(
  rawPhone: string,
  pin: string,
): Promise<void> {
  const baUserId = await ensureBaUserForPhone(rawPhone);
  await setCredential(baUserId, pin);
}

// Read-side: does this phone have a credential row?
//
// Two-step lookup because the better-auth schema puts email on
// ba_user and the credential row on ba_account. We must read the
// STORED email (whichever form the OTP plugin or our seed wrote) —
// never recompose. The lib/phone.ts header documents that the OTP
// plugin's temp email is the stripped form while redeem wrote the
// canonical +91 form in some paths; the live difference is a real
// shape that signInEmail must respect, not something we paper over.
export async function hasCredentialByBaUserId(baUserId: string): Promise<boolean> {
  const ctx = await auth.$context;
  const account = await withPlatform(async () => {
    const found = await ctx.internalAdapter.findCredentialAccount(baUserId);
    return found;
  });
  return !!account?.password;
}

export async function hasCredentialByPhone(phone: string): Promise<boolean> {
  const baUserRow = await withPlatform(async () => {
    const rows = await db
      .select({ id: baUser.id })
      .from(baUser)
      .where(eq(baUser.phoneNumber, phone))
      .limit(1);
    return rows;
  });
  const baUserId = baUserRow[0]?.id;
  if (!baUserId) return false;
  return hasCredentialByBaUserId(baUserId);
}

// Lockout bookkeeping — write failed_pin_attempts and pin_locked_until.
// Called from pinLogin on failure (lock predicate evaluated inside
// that function before this is reached).
// Main login: phone + PIN → Response. Returns the better-auth sign-in
// Response on success (which carries Set-Cookie); a generic 401
// Response on any failure (wrong PIN, locked, unknown phone, rate
// limited). No caller-visible branch between those two outcomes.
export async function pinLogin(rawPhone: string, pin: string): Promise<Response> {
  // Normalize first so the lockout lookup uses the canonical form
  // (matches how the seed and OTP plugin store users.phone).
  const phone = rawPhone.replace(/[\s\-()]/g, "").replace(/^0/, "+91");
  // (The full normaliseToE164 handles more shapes; for the login path
  // the above covers the common user input. If a future input shape
  // gets here unchanged it won't match a stored user — that's the
  // desired behaviour.)

  // 1. Look up the user row + lockout state.
  const userRow = await withPlatform(async () => {
    const rows = await db
      .select({
        id: users.id,
        failedPinAttempts: users.failedPinAttempts,
        pinLockedUntil: users.pinLockedUntil,
      })
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);
    return rows;
  });
  const user = userRow[0];
  if (!user) {
    // Unknown phone. Generic failure, no row created, no rate-limit
    // counter (we don't want this to slow down a brute-force scan
    // across fake phones).
    return genericFailure();
  }
  if (isPinLocked(user.pinLockedUntil)) {
    return genericFailure();
  }

  // 2. Resolve the ba_user row + its STORED email. We must read the
  // stored value (which may be the OTP plugin's stripped form or the
  // canonical +91 form) and pass it through unchanged to signInEmail.
  const baUserRow = await withPlatform(async () => {
    const rows = await db
      .select({ id: baUser.id, email: baUser.email })
      .from(baUser)
      .where(eq(baUser.phoneNumber, phone))
      .limit(1);
    return rows;
  });
  const ba = baUserRow[0];
  if (!ba) return genericFailure();

  // 3. Verify via better-auth. The public API (not auth.$context,
  // which exposes internals but no endpoint map). With
  // asResponse:true a failed sign-in comes back as an error
  // Response instead of a throw; either way anything non-2xx is a
  // failure and gets bookkept. A thrown error (e.g. malformed
  // stored email) is treated the same way — never surfaced.
  //
  // withPlatform is load-bearing, not decoration: better-auth runs
  // its own Drizzle queries through the same guarded pool, and the
  // dev/test scope guard replaces any query it sees as unscoped
  // (see db/client.ts). The catch-all auth route wraps
  // auth.handler the same way for the same reason.
  let res: Response;
  try {
    res = await withPlatform(async () => {
      const signIn = await auth.api.signInEmail({
        body: { email: ba.email, password: pin },
        asResponse: true,
      });
      return signIn as Response;
    });
  } catch {
    res = genericFailure();
  }

  // 4. Lockout bookkeeping: failures bump; success clears.
  if (res.status >= 200 && res.status < 300) {
    await clearPinFailures(user.id);
    return res;
  }

  await recordPinFailure(user.id);
  // Hide the real status behind the generic 401 (don't leak
  // rate-limit / bad-credential distinctions to the caller).
  return genericFailure();
}

// Surface baAccount export for callers that need to inspect
// credential rows (currently only tests).
export { baAccount };
