import { and, eq, sql } from "drizzle-orm";
import { initializeCredentialPinHash } from "@/db/credential-initialization";
import { v7 as uuidv7 } from "uuid";
import type { TenantTx } from "@/db/tenant";
import { baAccount, baUser } from "@/db/schema/better-auth";
import { users } from "@/db/schema/users";
import { memberAccountLinks, guardianChildLinks } from "@/db/schema/member-self";
import { writeAudit } from "@/lib/audit/write";
import type { TenantId, UserId } from "@/lib/ids";
import { auth } from "@/lib/auth/server";
import { CREDENTIAL_ISSUER } from "@/lib/services/credentials";
import { normaliseToE164 } from "@/lib/phone";
export type CredentialHasher = {
    hash(pin: string): Promise<string>;
    verify(hash: string, pin: string): Promise<boolean>;
};
export async function credentialHasher(): Promise<CredentialHasher> {
    const ctx = await auth.$context;
    return {
        hash: (pin) => ctx.password.hash(pin),
        verify: (hash, pin) => ctx.password.verify({ hash, password: pin }),
    };
}
// Ambient-session initialization must never rotate a PIN. Hash through the
// existing better-auth hasher; the scoped adapter arbitrates the write and
// commits its global identity audit in the same app-login transaction.
export async function initializeCredentialIfAbsent(baUserId: string, pin: string): Promise<boolean> {
    const hasher = await credentialHasher();
    const pinHash = await hasher.hash(pin);
    return initializeCredentialPinHash({ baUserId, pinHash, issuer: CREDENTIAL_ISSUER });
}
export async function readCredentialPinHashInTx(tx: TenantTx, baUserId: string): Promise<string | null> {
    const rows = await tx
        .select({ password: baAccount.password })
        .from(baAccount)
        .where(and(eq(baAccount.userId, baUserId), eq(baAccount.providerId, "credential"), eq(baAccount.issuer, CREDENTIAL_ISSUER), eq(baAccount.accountId, baUserId)))
        .limit(1)
        .for("update");
    return rows[0]?.password ?? null;
}
export async function setCredentialIfAbsentInTx(tx: TenantTx, baUserId: string, pinHash: string): Promise<string | null> {
    const inserted = await tx
        .insert(baAccount)
        .values({
        id: uuidv7(),
        userId: baUserId,
        accountId: baUserId,
        providerId: "credential",
        issuer: CREDENTIAL_ISSUER,
        password: pinHash,
    })
        .onConflictDoNothing()
        .returning({ id: baAccount.id });
    return inserted[0]?.id ?? null;
}
export async function readBaUserIdByPhoneInTx(tx: TenantTx, phone: string): Promise<string | null> {
    const rows = await tx
        .select({ id: baUser.id })
        .from(baUser)
        .where(eq(baUser.phoneNumber, normaliseToE164(phone)))
        .limit(1);
    return rows[0]?.id ?? null;
}
export async function readBaUserIdInTx(tx: TenantTx, baUserId: string): Promise<string | null> {
    const rows = await tx
        .select({ id: baUser.id })
        .from(baUser)
        .where(eq(baUser.id, baUserId))
        .limit(1);
    return rows[0]?.id ?? null;
}
export async function ensureBaUserForPhoneInTx(tx: TenantTx, args: {
    phone: string;
    phoneNumberVerified: boolean;
}): Promise<{
    baUserId: string;
    created: boolean;
}> {
    const phone = normaliseToE164(args.phone);
    const existing = await readBaUserIdByPhoneInTx(tx, phone);
    if (existing)
        return { baUserId: existing, created: false };
    const inserted = await tx
        .insert(baUser)
        .values({
        id: uuidv7(),
        name: phone,
        email: `${phone}@phone.aqua.local`,
        phoneNumber: phone,
        phoneNumberVerified: args.phoneNumberVerified,
    })
        .onConflictDoNothing()
        .returning({ id: baUser.id });
    if (inserted[0])
        return { baUserId: inserted[0].id, created: true };
    const retry = await readBaUserIdByPhoneInTx(tx, phone);
    if (!retry) {
        throw new Error("ensureBaUserForPhoneInTx: the identity row could not be read back after the insert");
    }
    return { baUserId: retry, created: false };
}
export async function linkBaUserToAccountInTx(tx: TenantTx, args: {
    tenantId: TenantId;
    userId: UserId;
    baUserId: string;
}): Promise<boolean> {
    const linkedInThisClub = sql `exists (
    select 1 from ${memberAccountLinks}
      where ${memberAccountLinks.userId} = ${users.id}
        and ${memberAccountLinks.tenantId} = ${args.tenantId}
    union all
    select 1 from ${guardianChildLinks}
      where ${guardianChildLinks.userId} = ${users.id}
        and ${guardianChildLinks.tenantId} = ${args.tenantId}
  )`;
    const rows = await tx
        .update(users)
        .set({
        betterAuthId: args.baUserId,
        updatedAt: new Date(),
        updatedBy: args.userId,
    })
        .where(and(eq(users.id, args.userId), linkedInThisClub))
        .returning({ id: users.id });
    if (rows.length === 0)
        return false;
    await writeAudit(tx, {
        tenantId: args.tenantId, actorType: "user", actorId: args.userId,
        action: "self.account.identity_linked", entityType: "user", entityId: args.userId,
        before: { betterAuthId: null }, after: { betterAuthId: args.baUserId },
        changedFields: ["better_auth_id"],
    });
    return true;
}
