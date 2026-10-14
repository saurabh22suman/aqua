import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { platformUsers, platformSessions, platformAuditLog } from "./schema/platform-users";
import { whatsappAuthChallenges as challenges } from "./schema/whatsapp";
import { users } from "./schema/users";
import { baAccount, baSession } from "./schema/better-auth";
import { activeTenantLogin, verifyWhatsAppChallenge, withWhatsAppAuthTx } from "./whatsapp-auth";
import { sha256, PLATFORM_SESSION_TTL_SECONDS } from "./platform-auth-crypto";
import { auth } from "@/lib/auth/server";
import { pinSchema } from "@/lib/services/credentials";

export async function finishOpsWhatsAppLogin(token: string, code: string) {
  return verifyWhatsAppChallenge(token, code, "ops_login", async (tx, id, phone) => {
    const [user] = await tx.select().from(platformUsers).where(eq(platformUsers.id, id)).for("update");
    if (!user || user.status !== "active" || user.phone !== phone) throw new Error("Sign-in is unavailable for this account.");
    const sessionToken = randomBytes(32).toString("hex");
    await tx.insert(platformSessions).values({ userId: id, tokenHash: sha256(sessionToken),
      secondFactorPassed: true, expiresAt: new Date(Date.now() + PLATFORM_SESSION_TTL_SECONDS * 1000) });
    await tx.update(platformUsers).set({ lastLoginAt: new Date() }).where(eq(platformUsers.id, id));
    await tx.update(challenges).set({ consumedAt: new Date() }).where(eq(challenges.tokenHash, sha256(token)));
    await tx.insert(platformAuditLog).values({ actorId: id, action: "platform.login",
      detail: { method: "whatsapp_otp" } });
    return sessionToken;
  });
}

export async function verifyPinResetCode(token: string, code: string) {
  return verifyWhatsAppChallenge(token, code, "pin_reset", async () => true);
}

export async function saveResetPin(token: string, pin: string) {
  pinSchema.parse(pin);
  const hash = await (await auth.$context).password.hash(pin);
  const principal = await withWhatsAppAuthTx(async (tx) => {
    const [row] = await tx.select({ id: challenges.principalId }).from(challenges)
      .where(eq(challenges.tokenHash, sha256(token)));
    return row?.id;
  });
  if (!principal || !await activeTenantLogin(principal)) return false;
  return withWhatsAppAuthTx(async (tx) => {
    const [row] = await tx.select().from(challenges)
      .where(eq(challenges.tokenHash, sha256(token))).for("update");
    if (!row || row.purpose !== "pin_reset" || !row.verifiedAt || row.consumedAt ||
      row.principalId !== principal || row.expiresAt.getTime() <= Date.now()) return false;
    const [user] = await tx.select().from(users).where(eq(users.id, principal as never)).for("update");
    if (!user?.betterAuthId || user.phone !== row.phone) return false;
    const [account] = await tx.select({ id: baAccount.id }).from(baAccount)
      .where(and(eq(baAccount.userId, user.betterAuthId), eq(baAccount.providerId, "credential"),
        eq(baAccount.issuer, "local:credential"))).for("update");
    if (account) {
      await tx.update(baAccount).set({ password: hash, updatedAt: new Date() }).where(eq(baAccount.id, account.id));
    } else {
      await tx.insert(baAccount).values({ id: uuidv7(), userId: user.betterAuthId,
        accountId: user.betterAuthId, providerId: "credential", issuer: "local:credential", password: hash });
    }
    await tx.delete(baSession).where(eq(baSession.userId, user.betterAuthId));
    await tx.update(users).set({ failedPinAttempts: 0, pinLockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await tx.update(challenges).set({ consumedAt: new Date() }).where(eq(challenges.tokenHash, row.tokenHash));
    await tx.insert(platformAuditLog).values({ action: "credentials.pin_reset", targetType: "user", targetId: user.id });
    return true;
  });
}
