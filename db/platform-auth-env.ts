import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { TenantTx } from "./tenant";
import { platformUsers, platformSessions } from "./schema/platform-users";
import { PlatformAuthError, PLATFORM_CHALLENGE_TTL_SECONDS, constantTimeStringEqual, sha256 } from "./platform-auth-crypto";

/** Keep the configured password, but never treat it as a second factor. */
export async function loginWithEnvOperator(
  input: { email: string; password: string },
  meta: { ipAddress?: string; userAgent?: string },
  opsEmail: string,
  opsPassword: string,
  tx: TenantTx,
): Promise<{ kind: "second_factor_required"; sessionToken: string; userId: string }> {
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
    secondFactorPassed: false,
    expiresAt: new Date(Date.now() + PLATFORM_CHALLENGE_TTL_SECONDS * 1000),
  });
  return { kind: "second_factor_required", sessionToken, userId: operator.id };
}
