import { and, eq, isNull, or, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant, type TenantTx } from "./tenant";
import { tenantMemberships } from "./schema/memberships";
import { tenants } from "./schema/tenants";
import { roles } from "./schema/roles";
import { users } from "./schema/users";
import { baAccount, baSession, baUser } from "./schema/better-auth";
import { inviteLinkUses } from "./schema/invite-link-uses";
import { platformAuditLog } from "./schema/platform-users";
import { writeAudit } from "@/lib/audit/write";
import { asTenantId } from "@/lib/ids";
import { normaliseToE164 } from "@/lib/phone";
import type { InviteLinkClaims } from "@/lib/services/invite-link-token";
import type { RedeemLoginLinkError, RedeemLoginLinkResult } from "@/lib/services/invite-link";
import type { CREDENTIAL_ISSUER } from "@/lib/services/credentials";

// REVIEW ONLY: the caller must supply a tested Better Auth session mint bound
// to this exact tx; a global internalAdapter call does not satisfy this type's
// semantic contract. Failure must throw, so the entire redemption rolls back.
type MintSessionInTx = (tx: TenantTx, baUserId: string) => Promise<string>;
class Refused extends Error {
  constructor(readonly code: RedeemLoginLinkError) { super(code); }
}

// The Drizzle query error wraps the PostgreSQL driver error as its cause.
// Limit traversal and retry only a known transaction-level deadlock abort.
function isDeadlock(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === "40P01") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export async function redeemStaffLinkInTx(input: {
  claims: InviteLinkClaims;
  pinHash?: string;
  issuer: typeof CREDENTIAL_ISSUER;
  mintSession: MintSessionInTx;
}): Promise<RedeemLoginLinkResult> {
  const { claims, pinHash, issuer, mintSession } = input;
  const tenantId = asTenantId(claims.tenantId);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTenant(tenantId, async (tx) => {
      // Lock membership first; credential arbitration precedes the user-row lock.
      // A conflict or later refusal throws; returning a refusal after writes
      // would commit the transaction.
      const [m] = await tx.select({
        membershipId: tenantMemberships.id, status: tenantMemberships.status,
        linksValidFrom: tenantMemberships.linksValidFrom, roleId: tenantMemberships.roleId, userId: users.id,
        phone: users.phone, betterAuthId: users.betterAuthId,
      }).from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantId)))
        .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
        .where(and(eq(tenantMemberships.id, claims.membershipId),
          eq(tenantMemberships.tenantId, tenantId), isNull(tenantMemberships.deletedAt),
          isNull(users.deletedAt), isNull(roles.deletedAt)))
        .limit(1).for("update", { of: tenantMemberships });
      if (!m) throw new Refused("membership_not_found");
      // Preserve live role and tenant authority through commit without locking
      // the global user before the credential (member activation order).
      const [role] = await tx.select({ key: roles.key, homePath: roles.homePath })
        .from(roles).where(and(eq(roles.id, m.roleId), eq(roles.tenantId, tenantId),
          isNull(roles.deletedAt))).limit(1).for("share");
      const [tenant] = await tx.select({ status: tenants.status }).from(tenants)
        .where(eq(tenants.id, tenantId)).limit(1).for("share");
      if (!role || !tenant) throw new Refused("membership_not_found");
      if (m.status === "revoked") throw new Refused("revoked");
      if (tenant.status !== "trial" && tenant.status !== "active") throw new Refused("tenant_suspended");
      if (claims.exp * 1000 <= Date.now() ||
          (m.linksValidFrom && claims.iat * 1000 + 1000 <= m.linksValidFrom.getTime())) {
        throw new Refused("invalid");
      }
      if (claims.purpose === "reset" && role.key !== "owner") throw new Refused("not_owner");

      // Already-linked identity is authoritative, even when its phone differs.
      let baUserId = m.betterAuthId;
      let identityCreated = false;
      if (baUserId !== null) {
        if (baUserId.length === 0) throw new Refused("invalid");
        const [existing] = await tx.select({ id: baUser.id }).from(baUser)
          .where(eq(baUser.id, baUserId)).limit(1);
        if (!existing) throw new Refused("invalid");
      } else {
        const phone = normaliseToE164(m.phone);
        const [existing] = await tx.select({ id: baUser.id }).from(baUser)
          .where(eq(baUser.phoneNumber, phone)).limit(1);
        if (existing) {
          baUserId = existing.id;
        } else {
          const [created] = await tx.insert(baUser).values({
            id: uuidv7(), name: phone, email: `${phone}@phone.aqua.local`,
            phoneNumber: phone, phoneNumberVerified: false,
          }).onConflictDoNothing().returning({ id: baUser.id });
          if (created) {
            baUserId = created.id;
            identityCreated = true;
          } else {
            const [retry] = await tx.select({ id: baUser.id }).from(baUser)
              .where(eq(baUser.phoneNumber, phone)).limit(1);
            if (!retry) throw new Refused("invalid");
            baUserId = retry.id;
          }
        }

      }

      const canonical = and(eq(baAccount.userId, baUserId), eq(baAccount.accountId, baUserId),
        eq(baAccount.providerId, "credential"), eq(baAccount.issuer, issuer));
      let credentialSet: boolean;
      if (pinHash !== undefined && claims.purpose !== "reset") {
        const filled = await tx.update(baAccount).set({ password: pinHash, updatedAt: new Date() })
          .where(and(canonical, or(isNull(baAccount.password), eq(baAccount.password, ""))))
          .returning({ id: baAccount.id });
        if (filled.length === 0) {
          const inserted = await tx.insert(baAccount).values({ id: uuidv7(), userId: baUserId,
            accountId: baUserId, providerId: "credential", issuer, password: pinHash })
            .onConflictDoNothing().returning({ id: baAccount.id });
          if (inserted.length === 0) throw new Refused("credential_already_set");
        }
        credentialSet = true;
        await writeAudit(tx, { tenantId, actorType: "user", actorId: m.userId,
          action: "staff.credential.initialized", entityType: "ba_account",
          after: { initialized: true }, changedFields: ["password"] });
      } else if (pinHash !== undefined) {
        // Conflict update is permitted only for the exact canonical identity.
        const written = await tx.insert(baAccount).values({ id: uuidv7(), userId: baUserId,
          accountId: baUserId, providerId: "credential", issuer, password: pinHash })
          .onConflictDoUpdate({ target: [baAccount.providerId, baAccount.accountId],
            set: { password: pinHash, updatedAt: new Date() },
            setWhere: and(eq(baAccount.userId, baUserId), eq(baAccount.issuer, issuer)) })
          .returning({ id: baAccount.id });
        if (written.length === 0) throw new Refused("invalid");
        credentialSet = true;
      } else {
        const [credential] = await tx.select({ password: baAccount.password }).from(baAccount)
          .where(canonical).limit(1).for("update");
        credentialSet = !!credential?.password;
      }

      // Re-read and lock the membership-joined user only after credential
      // arbitration. Reject a changed pointer or phone; a concurrent link to
      // the same BA principal is safe and needs no duplicate link audit.
      const [current] = await tx.select({ id: users.id, phone: users.phone,
        betterAuthId: users.betterAuthId }).from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .where(and(eq(tenantMemberships.id, m.membershipId),
          eq(tenantMemberships.tenantId, tenantId), eq(users.id, m.userId),
          isNull(tenantMemberships.deletedAt), isNull(users.deletedAt)))
        .limit(1).for("update", { of: users });
      if (!current || (m.betterAuthId !== null && current.betterAuthId !== m.betterAuthId) ||
          (m.betterAuthId === null && current.betterAuthId !== null && current.betterAuthId !== baUserId) ||
          (m.betterAuthId === null && current.phone !== m.phone)) throw new Refused("invalid");
      if (current.betterAuthId === null) {
        const linked = await tx.update(users).set({ betterAuthId: baUserId, updatedAt: new Date() })
          .where(and(eq(users.id, m.userId), isNull(users.betterAuthId), sql`exists (
            select 1 from ${tenantMemberships} where ${tenantMemberships.id} = ${m.membershipId}
              and ${tenantMemberships.tenantId} = ${tenantId} and ${tenantMemberships.userId} = ${users.id}
          )`)).returning({ id: users.id });
        if (linked.length !== 1) throw new Refused("invalid");
        await writeAudit(tx, { tenantId, actorType: "user", actorId: m.userId,
          action: "staff.identity.linked", entityType: "user", entityId: m.userId,
          after: { identityCreated }, changedFields: ["better_auth_id"] });
      }

      const used = await tx.insert(inviteLinkUses).values({ jti: claims.jti, tenantId,
        membershipId: m.membershipId, purpose: claims.purpose })
        .onConflictDoNothing({ target: inviteLinkUses.jti }).returning({ jti: inviteLinkUses.jti });
      if (used.length === 0) throw new Refused("used");
      if (m.status === "invited") {
        const activated = await tx.update(tenantMemberships)
          .set({ status: "active", updatedAt: new Date(), updatedBy: m.userId })
          .where(and(eq(tenantMemberships.id, m.membershipId), eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.status, "invited"))).returning({ id: tenantMemberships.id });
        if (activated.length !== 1) throw new Refused("revoked");
        await writeAudit(tx, { tenantId, actorType: "user", actorId: m.userId,
          action: "membership.activate", entityType: "tenant_membership", entityId: m.membershipId,
          before: { status: "invited" }, after: { status: "active" }, changedFields: ["status"] });
      }
      if (claims.purpose === "reset") {
        await tx.delete(baSession).where(eq(baSession.userId, baUserId));
        await tx.insert(platformAuditLog).values({ action: "credentials.pin_reset", tenantId,
          targetType: "user", targetId: m.userId, detail: { purpose: "reset",
            membershipId: m.membershipId, sessionsRevoked: true, credentialRotated: pinHash !== undefined } });
      }
      const sessionToken = await mintSession(tx, baUserId);
      if (!sessionToken) throw new Error("Better Auth session creation failed");
      // Credential, user, JTI or session operations can wait past expiry.
      // Throw inside the transaction so all writes and the session roll back.
      if (claims.exp * 1000 <= Date.now()) throw new Refused("invalid");
      const needsCredential = pinHash === undefined && !credentialSet;
      return { kind: "ok" as const, sessionToken,
        homePath: needsCredential ? "/set-pin" : (role.homePath ?? "/"), needsCredential };
      });
    } catch (error) {
      if (error instanceof Refused) return { kind: "error", code: error.code };
      // Drizzle errors may contain bound hashes or tokens. Never propagate
      // query text or driver details to a route or log.
      if (!isDeadlock(error) || attempt === 2) throw new Error("Staff link redemption failed");
      // withTenant has rejected after rollback; no partial attempt commits.
    }
  }
  throw new Error("Staff link redemption retry limit reached");
}
