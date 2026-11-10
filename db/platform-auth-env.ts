import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { TenantTx } from "./tenant";
import { platformUsers, platformSessions } from "./schema/platform-users";
import { PlatformAuthError, PLATFORM_CHALLENGE_TTL_SECONDS, PLATFORM_SESSION_TTL_SECONDS, constantTimeStringEqual, sha256 } from "./platform-auth-crypto";

/** Only the validated staging policy can grant a full password-only session. */
export async function loginWithEnvOperator(
  input: { email: string; password: string },
  meta: { ipAddress?: string; userAgent?: string },
  opsEmail: string,
  opsPassword: string,
  tx: TenantTx,
  stagingPasswordOnly: boolean,
): Promise<
  | { kind: "second_factor_required"; sessionToken: string; userId: string }
  | { kind: "fully_authenticated"; sessionToken: string; userId: string; role: "admin" | "viewer" }
> {
  const emailOk = constantTimeStringEqual(input.email.toLowerCase(), opsEmail.toLowerCase());
  const passwordOk = constantTimeStringEqual(input.password, opsPassword);
  if (!emailOk || !passwordOk) throw new PlatformAuthError("invalid_credentials", "invalid credentials");
  const [operator] = await tx.select().from(platformUsers)
    .where(eq(platformUsers.email, opsEmail.toLowerCase())).for("share");
  if (!operator || !operator.totpEnrolled || !operator.totpSecret) {
    throw new PlatformAuthError("no_totp", "platform user has no enrolled second factor");
  }
  if (operator.status !== "active") throw new PlatformAuthError("user_suspended", "user suspended");
  const sessionToken = randomBytes(32).toString("hex");
  await tx.insert(platformSessions).values({
    userId: operator.id, tokenHash: sha256(sessionToken),
    ipAddress: meta.ipAddress, userAgent: meta.userAgent,
    secondFactorPassed: stagingPasswordOnly,
    expiresAt: new Date(Date.now() + (stagingPasswordOnly ? PLATFORM_SESSION_TTL_SECONDS : PLATFORM_CHALLENGE_TTL_SECONDS) * 1000),
  });
  if (stagingPasswordOnly) {
    await tx.update(platformUsers).set({ lastLoginAt: new Date() }).where(eq(platformUsers.id, operator.id));
    return { kind: "fully_authenticated", sessionToken, userId: operator.id, role: operator.role as "admin" | "viewer" };
  }
  return { kind: "second_factor_required", sessionToken, userId: operator.id };
}
