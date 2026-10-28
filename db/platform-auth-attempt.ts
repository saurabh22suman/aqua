import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { and, eq, gte, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { db } from "./client";
import { withPlatform } from "./scope";
import type { TenantTx } from "./tenant";
import { platformAuditLog } from "./schema/platform-users";
import { PlatformAuthError } from "./platform-auth-crypto";

export type LoginMeta = { ipAddress?: string; userAgent?: string };
export const OPS_ATTEMPT_WINDOW_MS = 15 * 60_000;
export const OPS_ACCOUNT_ATTEMPTS = 5;
export const OPS_ADDRESS_ATTEMPTS = 20;

/** Persistent, transaction-serialized attempt control; no process-local counter. */
export async function runPlatformLoginAttempt<T>(
  phase: "password" | "totp",
  identity: string,
  meta: LoginMeta,
  authenticate: (tx: TenantTx) => Promise<{ value: T; actorId: string; totpStep?: number }>,
): Promise<T> {
  const identityHash = createHmac("sha256", env.BETTER_AUTH_SECRET ?? "ops-attempt-development-only")
    .update(`ops-login:${phase}:${identity.trim().toLowerCase()}`).digest("hex");
  const ipAddress = meta.ipAddress && isIP(meta.ipAddress) ? meta.ipAddress : undefined;
  const outcome = await withPlatform(() => db.transaction(async tx => {
    const locks = [`ops-account:${identityHash}`];
    if (ipAddress) locks.push(`ops-address:${phase}:${ipAddress}`);
    for (const key of locks.sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    }
    const [attempts] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(platformAuditLog).where(and(
        eq(platformAuditLog.action, "platform.login.failed"),
        gte(platformAuditLog.createdAt, new Date(Date.now() - OPS_ATTEMPT_WINDOW_MS)),
        sql`${platformAuditLog.detail}->>'identityHash' = ${identityHash}`,
        sql`${platformAuditLog.detail}->>'phase' = ${phase}`,
      ));
    const [addressAttempts] = ipAddress ? await tx.select({ count: sql<number>`count(*)::int` })
      .from(platformAuditLog).where(and(
        eq(platformAuditLog.action, "platform.login.failed"),
        eq(platformAuditLog.ipAddress, ipAddress),
        gte(platformAuditLog.createdAt, new Date(Date.now() - OPS_ATTEMPT_WINDOW_MS)),
        sql`${platformAuditLog.detail}->>'phase' = ${phase}`,
      )) : [];
    if ((attempts?.count ?? 0) >= OPS_ACCOUNT_ATTEMPTS || (addressAttempts?.count ?? 0) >= OPS_ADDRESS_ATTEMPTS) {
      await tx.insert(platformAuditLog).values({
        action: "platform.login.throttled", ipAddress,
        detail: { phase, identityHash }, createdAt: new Date(),
      });
      return { error: new PlatformAuthError("rate_limited", "Sign-in is temporarily unavailable. Try again later.") };
    }
    try {
      // A failed authentication rolls back its own mutations, while the
      // outer transaction can commit a safe failure event.
      const { value, actorId, totpStep } = await tx.transaction(authenticate);
      await tx.insert(platformAuditLog).values({
        actorId, action: phase === "totp" ? "platform.login" : "platform.login.password_passed", ipAddress,
        detail: { phase, identityHash, method: phase === "totp" ? "password_totp" : "password",
          ...(totpStep === undefined ? {} : { totpStep }) }, createdAt: new Date(),
      });
      return { value };
    } catch (error) {
      if (!(error instanceof PlatformAuthError)) throw error;
      await tx.insert(platformAuditLog).values({
        action: "platform.login.failed", ipAddress,
        detail: { phase, identityHash }, createdAt: new Date(),
      });
      return { error };
    }
  }));
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}
