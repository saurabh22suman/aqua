import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { platformAuditLog } from "./schema/platform-users";
import { whatsappAuthChallenges as challenges } from "./schema/whatsapp";
import { users } from "./schema/users";
import { baAccount, baSession } from "./schema/better-auth";
import { activeTenantLogin, verifyWhatsAppChallenge, withWhatsAppAuthTx } from "./whatsapp-auth";
import { sha256 } from "./platform-auth-crypto";
import { auth } from "@/lib/auth/server";
import { pinSchema } from "@/lib/services/credentials";

// Kept as a fail-closed compatibility export for already-issued legacy
// challenges. The HTTP route also refuses this passwordless Ops flow.
export async function finishOpsWhatsAppLogin(_token: string, _code: string): Promise<
  { ok: false } | { ok: true; value: string }
> {
  void _token; void _code; // Deliberately refuse every legacy credential.
  return { ok: false };
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
