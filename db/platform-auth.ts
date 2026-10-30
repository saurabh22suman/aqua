import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./client";
import { withPlatform } from "./scope";
import { env } from "@/lib/env";
import {
  PLATFORM_SESSION_TTL_SECONDS,
  PLATFORM_CHALLENGE_TTL_SECONDS,
  PlatformAuthError,
  constantTimeEqual,
  hashPassword,
  sha256,
} from "./platform-auth-crypto";
import { matchingTotpStep, generateTotpSecret } from "./platform-auth-totp";
export { currentTotpCode, verifyTotp, generateTotpSecret } from "./platform-auth-totp";
import { loginWithEnvOperator } from "./platform-auth-env";
import {
  classifyUnexpectedError,
  opsIdentityHash,
  recordUnauthEvent,
  runPlatformLoginAttempt,
} from "./platform-auth-attempt";
import {
  platformUsers,
  platformSessions,
  platformAuditLog,
} from "./schema";

export { PlatformAuthError, PLATFORM_SESSION_TTL_SECONDS } from "./platform-auth-crypto";
export {
  lookupPlatformSession,
  platformLogout,
  platformLogoutWithResult,
} from "./platform-auth-session";
export type { PlatformSessionLookup } from "./platform-auth-session";

export const platformLoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});
export type PlatformLoginInput = z.infer<typeof platformLoginInput>;

export const platformTotpInput = z.object({
  sessionToken: z.string().min(32).max(128),
  code: z.string().regex(/^\d{6}$/),
});
export type PlatformTotpInput = z.infer<typeof platformTotpInput>;

export type PlatformAuthResult =
  | { kind: "second_factor_required"; sessionToken: string }
  | { kind: "fully_authenticated"; sessionToken: string; userId: string; role: "admin" | "viewer" };

/**
 * Password check. Returns a half-authenticated session (the cookie) so
 * the caller can present the 2FA challenge; TOTP verification on a
 * separate call promotes it to fully_authenticated. Two-step on
 * purpose: a stolen password alone must not be enough.
 */
export async function platformLogin(
  input: PlatformLoginInput,
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<PlatformAuthResult> {
  return runPlatformLoginAttempt<PlatformAuthResult>("password", input.email, meta, async (db) => {
    // Preserve the configured password; an existing enrolled operator and
    // a separate authenticator proof are required on both password paths.
    if (env.OPS_EMAIL !== undefined && env.OPS_PASSWORD !== undefined) {
      const value = await loginWithEnvOperator(input, meta, env.OPS_EMAIL, env.OPS_PASSWORD, db);
      return { value, actorId: value.userId };
    }

    const [user] = await db
      .select()
      .from(platformUsers)
      .where(eq(platformUsers.email, input.email.toLowerCase()))
      .limit(1);
    if (!user) {
      // Constant-time the no-such-user path too: a wrong email should
      // not return instantly while a wrong password hashes and
      // compares. Cheap defence; nothing more.
      hashPassword(input.password, "decoy-salt-to-equal-real-cost");
      throw new PlatformAuthError("invalid_credentials", "invalid credentials");
    }
    const candidate = hashPassword(input.password, user.passwordSalt);
    if (!constantTimeEqual(candidate, user.passwordHash)) {
      throw new PlatformAuthError("invalid_credentials", "invalid credentials");
    }
    if (user.status !== "active") {
      throw new PlatformAuthError("user_suspended", "user suspended");
    }
    if (!user.totpEnrolled || !user.totpSecret) {
      throw new PlatformAuthError("no_totp", "platform user has no enrolled 2FA");
    }
    const sessionToken = randomBytes(32).toString("hex");
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + PLATFORM_CHALLENGE_TTL_SECONDS * 1000);
    await db.insert(platformSessions).values({
      id: sessionId,
      userId: user.id,
      tokenHash: sha256(sessionToken),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      secondFactorPassed: false,
      expiresAt,
    });
    return { value: { kind: "second_factor_required", sessionToken }, actorId: user.id };
  });
}

export async function platformVerifyTotp(
  input: PlatformTotpInput,
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<PlatformAuthResult> {
  const tokenHash = sha256(input.sessionToken);
  // The subject lookup runs BEFORE the attempt boundary, so an unexpected
  // failure here would leave no evidence at all. Record it — through the
  // bounded pre-auth policy, because an unauthenticated caller can reach
  // it — and let the original error reach the caller.
  let subject: { userId: string } | undefined;
  try {
    [subject] = await withPlatform(async () => await db.select({ userId: platformSessions.userId })
      .from(platformSessions).where(eq(platformSessions.tokenHash, tokenHash)).limit(1));
  } catch (error) {
    await recordUnauthEvent({
      action: "platform.login.error",
      detail: {
        phase: "totp",
        errorCode: classifyUnexpectedError(error),
      },
      ipAddress: meta.ipAddress,
      phase: "totp",
      outcome: "unexpected_error",
      // The session token is the only identity this pre-attempt path has;
      // record it only as the same pseudonymous hash the attempt uses.
      identityHash: opsIdentityHash("totp", input.sessionToken),
      correlationId: randomUUID(),
    });
    throw error;
  }
  if (!subject) {
    // The refusal passes through the attempt boundary so that it is
    // COUNTED and CAPPED — but on the UNKNOWN-CHALLENGE budget, which is
    // separate from the operator's budget. An unauthenticated caller
    // therefore cannot spend the budget that protects a real operator's
    // sign-in: the operator's own attempt is counted against
    // `platform.login.failed`, this one against
    // `platform.login.failed.unknown` — and this one is inside the
    // pre-auth budget as well, because it is written by a caller with no
    // valid session.
    //
    // The identity is the session token, recorded only as its
    // pseudonymous hash: there is no account to key an account limit on.
    return runPlatformLoginAttempt<PlatformAuthResult>(
      "totp",
      input.sessionToken,
      meta,
      async () => {
        throw new PlatformAuthError("session_invalid", "session not found");
      },
      { budget: "unknown_challenge" },
    );
  }
  return runPlatformLoginAttempt<PlatformAuthResult>("totp", subject.userId, meta, async (db) => {
    const tokenHash = sha256(input.sessionToken);
    const [session] = await db
      .select({
        session: platformSessions,
        user: platformUsers,
      })
      .from(platformSessions)
      .innerJoin(platformUsers, eq(platformUsers.id, platformSessions.userId))
      .where(eq(platformSessions.tokenHash, tokenHash))
      .limit(1).for("update");

    if (!session) {
      throw new PlatformAuthError("session_invalid", "session not found");
    }
    if (session.session.expiresAt.getTime() < Date.now()) {
      throw new PlatformAuthError("session_expired", "session expired");
    }
    if (session.session.secondFactorPassed) {
      throw new PlatformAuthError("session_invalid", "challenge already completed");
    }
    if (!session.user.totpSecret || !session.user.totpEnrolled) {
      throw new PlatformAuthError("no_totp", "no enrolled 2FA");
    }
    if (session.user.status !== "active") {
      throw new PlatformAuthError("user_suspended", "user suspended");
    }
    const totpStep = matchingTotpStep(session.user.totpSecret, input.code);
    if (totpStep === null) throw new PlatformAuthError("invalid_totp", "invalid TOTP code");
    // The account attempt lock serializes this check with the success audit.
    // Recording a non-secret counter enforces one-time use across challenges.
    const [used] = await db.select({ id: platformAuditLog.id }).from(platformAuditLog)
      .where(and(eq(platformAuditLog.actorId, session.user.id),
        eq(platformAuditLog.action, "platform.login"),
        sql`(${platformAuditLog.detail}->>'totpStep')::bigint >= ${totpStep}`)).limit(1);
    if (used) throw new PlatformAuthError("invalid_totp", "authenticator step already used");
    await db
      .update(platformSessions)
      .set({
        secondFactorPassed: true,
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + PLATFORM_SESSION_TTL_SECONDS * 1000),
      })
      .where(eq(platformSessions.id, session.session.id));
    await db
      .update(platformUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(platformUsers.id, session.user.id));
    return {
      value: {
        kind: "fully_authenticated",
        sessionToken: input.sessionToken,
        userId: session.user.id,
        role: session.user.role as "admin" | "viewer",
      },
      actorId: session.user.id,
      totpStep,
    };
  });
}

/**
 * Provisioning helper — creates a platform_user with a fresh password
 * and a TOTP secret (returned ONCE for the operator to enrol). Used by
 * the seed script and the platform admin UI; not exposed at runtime.
 * The TOTP secret here is base32; the operator scans it into their
 * authenticator and submits a verification code through the enrol UI to
 * flip totp_enrolled to true. Until then, login is impossible.
 */
export async function provisionPlatformUser(input: {
  email: string;
  name: string;
  password: string;
  role?: "admin" | "viewer";
  phone?: string;
}): Promise<{ id: string; totpSecret: string }> {
  const email = input.email.toLowerCase();
  const phone = input.phone ? z.string().regex(/^\+[1-9]\d{7,14}$/).parse(input.phone) : undefined;
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(input.password, salt);
  const totpSecret = generateTotpSecret();
  return withPlatform(async () => {
    const [row] = await db
      .insert(platformUsers)
      .values({
        email,
        name: input.name,
        phone,
        passwordHash,
        passwordSalt: salt,
        totpSecret,
        totpEnrolled: false,
        role: input.role ?? "admin",
      })
      .returning({ id: platformUsers.id });
    if (!row) throw new Error("insert failed");
    return { id: row.id, totpSecret };
  });
}

export async function markTotpEnrolled(userId: string): Promise<void> {
  await withPlatform(async () => {
    await db
      .update(platformUsers)
      .set({ totpEnrolled: true, updatedAt: new Date() })
      .where(eq(platformUsers.id, userId));
  });
}

// Re-exports for tests / scripts that need direct db access
export { platformUsers, platformSessions, platformAuditLog };
