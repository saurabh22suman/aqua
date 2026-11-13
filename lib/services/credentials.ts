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
// Staff login uses db/pin-login: address budgets and account locks protect
// the custom route independently of Better Auth’s HTTP-only middleware.
//
// 2026-11-09 member activation — ONE LINE IS NEW IN THIS POSTIMAGE:
// `CREDENTIAL_ISSUER` is EXPORTED, so the transaction-aware credential
// primitives (lib/services/self-service-credential.ts) resolve the SAME
// pinned issuer instead of writing the literal a second time. Nothing
// else in this file changes, and nothing here changes behaviour.

import { and, eq } from "drizzle-orm";
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
export { PIN_LOCKOUT_THRESHOLD, PIN_LOCKOUT_WINDOW_MS } from "./pin-lockout";


// better-auth's account issuer for locally-managed credentials:
// createLocalAccountIssuer("credential") === `local:${encodeURIComponent("credential")}`.
// Not exported from better-auth's public API, so it is pinned here
// (and in the migration test) rather than imported from a deep path.
// Aqua treats it as part of its canonical credential identity, regardless
// of changes in the upstream adapter's private account lookup.
export const CREDENTIAL_ISSUER = "local:credential";

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
  await withPlatform(() => db.transaction((tx) => setCredentialInTx(tx, baUserId, pin)));
}

// The tx-aware sibling of setCredential. The hash is still better-auth's
// own and the row keeps the canonical providerId/issuer, but the write
// joins the caller's transaction — so a credential rotation can commit
// together with the audit row that records it.
//
// IT OVERWRITES. It is the RESET path's tool, and it must never be used
// to set or reset a PIN through a member invitation: the member
// activation writes its first credential with
// `setCredentialIfAbsentInTx` (lib/services/self-service-credential.ts),
// which never updates.
type CredentialTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function setCredentialInTx(
  tx: CredentialTx,
  baUserId: string,
  pin: string,
): Promise<void> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(pin);
  const [existing] = await tx
    .select({ id: baAccount.id })
    .from(baAccount)
    .where(
      and(
        eq(baAccount.userId, baUserId),
        eq(baAccount.providerId, "credential"),
        eq(baAccount.issuer, CREDENTIAL_ISSUER),
        // Aqua's canonical identity is all FOUR fields. Matching fewer
        // could overwrite a different credential belonging to the same user.
        eq(baAccount.accountId, baUserId),
      ),
    )
    .limit(1);
  if (existing) {
    await tx
      .update(baAccount)
      .set({ password: hash, updatedAt: new Date() })
      .where(eq(baAccount.id, existing.id));
    return;
  }
  await tx.insert(baAccount).values({
    id: uuidv7(),
    userId: baUserId,
    accountId: baUserId,
    providerId: "credential",
    issuer: CREDENTIAL_ISSUER,
    password: hash,
  });
}

// Ensures the users row and the better-auth ba_user row exist for a
// canonical phone, links them, and returns the ba_user id. This is the
// identity half of magic-link redemption, extracted so the demo
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
/** Verify the existing PIN without creating a Better Auth staff session. */
export async function verifyCredentialPin(baUserId: string, pin: string): Promise<boolean> {
  const ctx = await auth.$context;
  const account = await readCanonicalCredential(baUserId);
  if (!account?.password) return false;
  return ctx.password.verify({ hash: account.password, password: pin });
}

export async function hasCredentialByBaUserId(baUserId: string): Promise<boolean> {
  const account = await readCanonicalCredential(baUserId);
  return !!account?.password;
}

async function readCanonicalCredential(baUserId: string) {
  return withPlatform(async () => {
    const [account] = await db.select({ password: baAccount.password }).from(baAccount).where(and(
      eq(baAccount.userId, baUserId), eq(baAccount.providerId, "credential"),
      eq(baAccount.accountId, baUserId), eq(baAccount.issuer, CREDENTIAL_ISSUER),
    )).limit(1);
    return account ?? null;
  });
}

export async function hasCredentialByPhone(phone: string): Promise<boolean> {
  const baUserId = await findBaUserIdByPhone(phone);
  if (!baUserId) return false;
  return hasCredentialByBaUserId(baUserId);
}

// R09 (2026-10-13 role-workflow audit) — read-only better-auth user
// lookup. Reactivating a revoked membership deletes the target's old
// sessions (they were invalidated by revocation and must not come back
// to life); this finds the account without creating one.
export async function findBaUserIdByPhone(phone: string): Promise<string | null> {
  const baUserRow = await withPlatform(async () => {
    const rows = await db
      .select({ id: baUser.id })
      .from(baUser)
      .where(eq(baUser.phoneNumber, phone))
      .limit(1);
    return rows;
  });
  return baUserRow[0]?.id ?? null;
}

// Staff sign-in uses a transaction-scoped adapter and persistent attempt gates.
export { pinLogin } from "@/db/pin-login";

// Surface baAccount export for callers that need to inspect
// credential rows (currently only tests).
export { baAccount };
