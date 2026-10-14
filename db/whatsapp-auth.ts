import { createHmac, randomBytes, randomInt } from "node:crypto";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import { whatsappAuthChallenges as challenges } from "./schema/whatsapp";
import { platformAuditLog, platformUsers } from "./schema/platform-users";
import { users } from "./schema/users";
import { withUser } from "./tenant";
import { tenantMemberships } from "./schema/memberships";
import { tenants } from "./schema/tenants";
import { env } from "@/lib/env";
import { normaliseToE164 } from "@/lib/phone";
import { getMessageProvider } from "@/lib/messaging/provider";
import { sha256, constantTimeEqual } from "./platform-auth-crypto";

export type WhatsAppAuthPurpose = "ops_login" | "pin_reset";
export type AuthTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const OTP_TTL_MS = 5 * 60_000;

export async function withWhatsAppAuthTx<T>(fn: (tx: AuthTx) => Promise<T>): Promise<T> {
  return withPlatform(() => db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.whatsapp_auth', 'true', true)`);
    return fn(tx);
  }));
}

function codeHash(token: string, code: string): string {
  if (!env.BETTER_AUTH_SECRET) throw new Error("Authentication secret is not configured.");
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`${token}:${code}`).digest("hex");
}

export async function activeTenantLogin(userId: string): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const rows = await tx.select({ id: tenantMemberships.id }).from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(and(eq(tenantMemberships.userId, userId as never),
        eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt),
        sql`${tenants.status} in ('active', 'trial')`)).limit(1);
    return rows.length > 0;
  });
}

async function principalFor(phone: string, purpose: WhatsAppAuthPurpose): Promise<string | null> {
  const id = await withPlatform(async () => {
    if (purpose === "ops_login") {
      const [row] = await db.select({ id: platformUsers.id }).from(platformUsers)
        .where(and(eq(platformUsers.phone, phone), eq(platformUsers.status, "active"))).limit(1);
      return row?.id ?? null;
    }
    const [row] = await db.select({ id: users.id, betterAuthId: users.betterAuthId }).from(users)
      .where(eq(users.phone, phone)).limit(1);
    return row?.betterAuthId ? row.id : null;
  });
  return id && (purpose === "ops_login" || await activeTenantLogin(id)) ? id : null;
}

export async function issueWhatsAppChallenge(rawPhone: string, purpose: WhatsAppAuthPurpose) {
  const phone = normaliseToE164(rawPhone);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Enter a valid mobile number.");
  const provider = getMessageProvider();
  if (!provider) throw new Error("WhatsApp is unavailable. Please try again later.");
  const principalId = await principalFor(phone, purpose);
  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await withWhatsAppAuthTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${purpose}:${phone}`}))`);
    const recent = await tx.select({ createdAt: challenges.createdAt }).from(challenges)
      .where(and(eq(challenges.phone, phone), eq(challenges.purpose, purpose),
        gte(challenges.createdAt, new Date(Date.now() - 60 * 60_000))));
    if (recent.length >= 5 || recent.some((r) => r.createdAt.getTime() > Date.now() - 60_000)) {
      throw new Error("Please wait before requesting another code.");
    }
    await tx.update(challenges).set({ consumedAt: new Date() })
      .where(and(eq(challenges.phone, phone), eq(challenges.purpose, purpose), isNull(challenges.consumedAt)));
    await tx.insert(challenges).values({ tokenHash, purpose, phone, principalId,
      codeHash: codeHash(token, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
    await tx.insert(platformAuditLog).values({ action: `auth.${purpose}.requested`,
      targetType: "whatsapp_challenge", detail: { tokenHash } });
  });
  // Unknown/inactive numbers get the same UI response but no message.
  if (principalId) {
    try {
      await provider.send({ toPhone: phone, category: "authentication",
        body: `Your Aqua ${purpose === "ops_login" ? "operator sign-in" : "PIN reset"} code is ${code}. It expires in 5 minutes. Do not share this code.` });
    } catch {
      await withWhatsAppAuthTx(async (tx) => {
        await tx.insert(platformAuditLog).values({ action: `auth.${purpose}.delivery_failed`,
          targetType: "whatsapp_challenge", detail: { tokenHash } });
      });
      // Do not reveal whether a number exists through an outage response.
      // Undelivered challenges can never verify; the user can request again.
      return token;
    }
    await withWhatsAppAuthTx(async (tx) => {
      await tx.update(challenges).set({ delivered: true }).where(eq(challenges.tokenHash, tokenHash));
      await tx.insert(platformAuditLog).values({ action: `auth.${purpose}.dispatched`,
        targetType: "whatsapp_challenge", detail: { tokenHash } });
    });
  }
  return token;
}

export async function verifyWhatsAppChallenge<T>(token: string, code: string,
  purpose: WhatsAppAuthPurpose, success: (tx: AuthTx, principalId: string, phone: string) => Promise<T>) {
  return withWhatsAppAuthTx(async (tx) => {
    const [row] = await tx.select().from(challenges)
      .where(eq(challenges.tokenHash, sha256(token))).for("update");
    if (!row || row.purpose !== purpose || !row.delivered || !row.principalId ||
      row.consumedAt || row.verifiedAt || row.attempts >= 5 || row.expiresAt.getTime() <= Date.now()) {
      return { ok: false as const };
    }
    const valid = /^\d{6}$/.test(code) && constantTimeEqual(row.codeHash, codeHash(token, code));
    await tx.update(challenges).set({ attempts: row.attempts + 1,
      ...(valid ? { verifiedAt: new Date(),
        expiresAt: purpose === "pin_reset" ? new Date(Date.now() + OTP_TTL_MS) : row.expiresAt } : {}) })
      .where(eq(challenges.tokenHash, row.tokenHash));
    await tx.insert(platformAuditLog).values({ action: `auth.${purpose}.${valid ? "verified" : "rejected"}`,
      targetType: "whatsapp_challenge", detail: { tokenHash: row.tokenHash } });
    if (!valid) return { ok: false as const };
    const value = await success(tx, row.principalId, row.phone);
    return { ok: true as const, value };
  });
}
