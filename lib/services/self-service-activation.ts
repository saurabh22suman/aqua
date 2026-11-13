import { and, eq, isNull } from "drizzle-orm";
import { withTenant, withUser, type TenantTx } from "@/db/tenant";
import { writeAudit } from "@/lib/audit/write";
import { readSelfServiceAccountInTx } from "@/db/self-service-account";
import { tenantMemberships } from "@/db/schema/memberships";
import { guardianChildLinks, memberAccountLinks, } from "@/db/schema/member-self";
import { selfServiceLinkUses, type SelfServiceAudience, } from "@/db/schema/self-service-session";
import { readNamedActivationLink } from "@/lib/services/self-service-activation-link";
import { credentialHasher, ensureBaUserForPhoneInTx, readBaUserIdByPhoneInTx, readBaUserIdInTx, readCredentialPinHashInTx, setCredentialIfAbsentInTx, linkBaUserToAccountInTx, } from "@/lib/services/self-service-credential";
import { SelfServiceAuthorizationError, mintSelfServiceSessionInTx, } from "@/lib/services/self-service-session";
import { clubRecordIsCurrent, readLiveLinkIds, readLinkFacts } from "@/lib/services/self-service-link-facts";
import { validateOmittedGuardianLinks } from "@/lib/services/self-service-session";
import type { SelfServiceTokenClaims } from "@/lib/services/self-service-token";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";
export type ActivationErrorCode = "invalid" | "used" | "not_invited" | "pin_mismatch" | "credential_conflict" | "identity_conflict" | "identity_missing" | "staff_credential_refused" | "gate_refused";
export type ActivationOutcome = {
    kind: "ok";
    audience: SelfServiceAudience;
    subjectId: string | null;
    linkId: string;
    sessionId: string;
    cookieValue: string;
    expiresAt: Date;
    credentialCreated: boolean;
    identityCreated: boolean;
} | {
    kind: "error";
    code: ActivationErrorCode;
};
export class ActivationRefused extends Error {
    readonly code: ActivationErrorCode;
    constructor(code: ActivationErrorCode) {
        super(`self-service activation refused: ${code}`);
        this.name = "ActivationRefused";
        this.code = code;
    }
}
export async function activateSelfServiceAccount(input: {
    claims: SelfServiceTokenClaims;
    pin: string;
}): Promise<ActivationOutcome> {
    const { claims } = input;
    if (claims.linkIds.length !== 1) {
        return { kind: "error", code: "invalid" };
    }
    const linkId = claims.linkIds[0]!;
    const tenantId = asTenantId(claims.tenantId);
    const userId = asUserId(claims.userId);
    const hasher = await credentialHasher();
    const pinHash = await hasher.hash(input.pin);
    const staffTenants = await withUser(userId, (tx) => readStaffMembershipTenantIds(tx, userId));
    try {
        return await withTenant(tenantId, async (tx) => {
            const named = await readNamedActivationLink(tx, {
                tenantId,
                userId,
                audience: claims.audience,
                linkId,
            });
            if (!named)
                throw new ActivationRefused("invalid");
            if (claims.audience === "member" && named.memberId !== claims.subjectId) {
                throw new ActivationRefused("invalid");
            }
            if (claims.audience === "guardian" && claims.subjectId !== null) {
                throw new ActivationRefused("invalid");
            }
            if (!clubRecordIsCurrent(named.recordedPhone, named.personPhone)) {
                throw new ActivationRefused("invalid");
            }
            if (await isTokenSpent(tx, claims.jti)) {
                throw new ActivationRefused("used");
            }
            if (named.status !== "invited") {
                throw new ActivationRefused("not_invited");
            }
            const account = await readSelfServiceAccountInTx(tx, {
                tenantId,
                userId,
            });
            if (!account)
                throw new ActivationRefused("invalid");
            const accountHasIdentity = account.betterAuthId !== null;
            let knownBaUserId = account.betterAuthId;
            if (knownBaUserId !== null) {
                if (!(await readBaUserIdInTx(tx, knownBaUserId))) {
                    throw new ActivationRefused("identity_missing");
                }
            }
            else {
                knownBaUserId = await readBaUserIdByPhoneInTx(tx, account.phone);
            }
            const storedHash = knownBaUserId === null
                ? null
                : await readCredentialPinHashInTx(tx, knownBaUserId);
            let baUserId: string;
            let credentialCreated = false;
            let createdCredentialId: string | null = null;
            let identityCreated = false;
            if (storedHash === null) {
                const staffHere = await hasLiveStaffMembershipInTx(tx, {
                    tenantId,
                    userId,
                });
                if (staffTenants.length > 0 || staffHere) {
                    throw new ActivationRefused("staff_credential_refused");
                }
                if (knownBaUserId === null) {
                    const ensured = await ensureBaUserForPhoneInTx(tx, {
                        phone: account.phone,
                        phoneNumberVerified: false,
                    });
                    baUserId = ensured.baUserId;
                    identityCreated = ensured.created;
                }
                else {
                    baUserId = knownBaUserId;
                }
                const written = await setCredentialIfAbsentInTx(tx, baUserId, pinHash);
                if (!written) {
                    throw new ActivationRefused("credential_conflict");
                }
                credentialCreated = true;
                createdCredentialId = written;
            }
            else {
                if (knownBaUserId === null) {
                    throw new ActivationRefused("identity_missing");
                }
                baUserId = knownBaUserId;
                const ok = await hasher.verify(storedHash, input.pin);
                if (!ok)
                    throw new ActivationRefused("pin_mismatch");
            }
            if (!accountHasIdentity) {
                const linked = await linkBaUserToAccountInTx(tx, {
                    tenantId,
                    userId: account.userId,
                    baUserId,
                });
                if (!linked)
                    throw new ActivationRefused("identity_conflict");
            }
            const used = await tx
                .insert(selfServiceLinkUses)
                .values({
                jti: claims.jti,
                tenantId,
                userId,
                memberLinkId: claims.audience === "member" ? linkId : null,
                guardianLinkId: claims.audience === "guardian" ? linkId : null,
            })
                .onConflictDoNothing({ target: selfServiceLinkUses.jti })
                .returning({ jti: selfServiceLinkUses.jti });
            if (used.length === 0)
                throw new ActivationRefused("used");
            const flipped = claims.audience === "member"
                ? await tx
                    .update(memberAccountLinks)
                    .set({ status: "active", updatedAt: new Date(), updatedBy: userId })
                    .where(and(eq(memberAccountLinks.id, linkId), eq(memberAccountLinks.tenantId, tenantId), eq(memberAccountLinks.status, "invited")))
                    .returning({ id: memberAccountLinks.id })
                : await tx
                    .update(guardianChildLinks)
                    .set({ status: "active", updatedAt: new Date(), updatedBy: userId })
                    .where(and(eq(guardianChildLinks.id, linkId), eq(guardianChildLinks.tenantId, tenantId), eq(guardianChildLinks.status, "invited")))
                    .returning({ id: guardianChildLinks.id });
            if (flipped.length === 0)
                throw new ActivationRefused("not_invited");
            let sessionLinkIds = [linkId];
            if (claims.audience === "guardian") {
                const liveIds = await readLiveLinkIds(tx, { tenantId, userId, audience: "guardian" });
                const facts = await readLinkFacts(tx, { tenantId, userId, audience: "guardian", linkIds: liveIds });
                if (facts.length !== liveIds.length) throw new ActivationRefused("gate_refused");
                const omitted = facts.filter((fact) => fact.childPersonSoftDeleted).map((fact) => fact.linkId);
                if (!await validateOmittedGuardianLinks(tx, { tenantId, userId, linkIds: omitted, accountPhone: account.phone })) {
                    throw new ActivationRefused("gate_refused");
                }
                sessionLinkIds = facts.filter((fact) => !fact.childPersonSoftDeleted).map((fact) => fact.linkId);
            }
            const minted = await mintSelfServiceSessionInTx(tx, {
                tenantId,
                userId,
                audience: claims.audience,
                subjectId: claims.audience === "member" ? claims.subjectId : null,
                linkIds: sessionLinkIds,
                accountPhone: account.phone,
            });
            if (identityCreated) {
                await writeAudit(tx, {
                    tenantId,
                    actorType: "user",
                    actorId: userId,
                    action: "self.identity.created",
                    entityType: "ba_user",
                    entityId: baUserId,
                    after: { created: true, phoneNumberVerified: false },
                    changedFields: null,
                });
            }
            if (credentialCreated && createdCredentialId !== null) {
                await writeAudit(tx, {
                    tenantId,
                    actorType: "user",
                    actorId: userId,
                    action: "self.credential.set",
                    entityType: "ba_account",
                    entityId: createdCredentialId,
                    after: { created: true },
                    changedFields: ["password"],
                });
            }
            await writeAudit(tx, {
                tenantId,
                actorType: "user",
                actorId: userId,
                action: claims.audience === "member"
                    ? "member.account_link.activate"
                    : "guardian.child_link.activate",
                entityType: named.entityType,
                entityId: named.entityId,
                before: { status: "invited" },
                after: {
                    linkId,
                    userId: claims.userId,
                    tenantId: claims.tenantId,
                    audience: claims.audience,
                    subjectId: claims.subjectId,
                    verificationMethod: "club_record",
                    assurance: "recorded_number_only",
                },
                changedFields: ["status"],
            });
            return {
                kind: "ok" as const,
                audience: claims.audience,
                subjectId: claims.audience === "member" ? claims.subjectId : null,
                linkId,
                sessionId: minted.sessionId,
                cookieValue: minted.cookieValue,
                expiresAt: minted.expiresAt,
                credentialCreated,
                identityCreated,
            };
        });
    }
    catch (error) {
        if (error instanceof ActivationRefused) {
            return { kind: "error", code: error.code };
        }
        if (error instanceof SelfServiceAuthorizationError) {
            return { kind: "error", code: "gate_refused" };
        }
        throw error;
    }
}
async function isTokenSpent(tx: TenantTx, jti: string): Promise<boolean> {
    const rows = await tx
        .select({ jti: selfServiceLinkUses.jti })
        .from(selfServiceLinkUses)
        .where(eq(selfServiceLinkUses.jti, jti))
        .limit(1);
    return rows.length > 0;
}
async function readStaffMembershipTenantIds(tx: TenantTx, userId: UserId): Promise<string[]> {
    const rows = await tx
        .select({ tenantId: tenantMemberships.tenantId })
        .from(tenantMemberships)
        .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt)));
    return rows.map((row) => row.tenantId);
}
async function hasLiveStaffMembershipInTx(tx: TenantTx, args: {
    tenantId: TenantId;
    userId: UserId;
}): Promise<boolean> {
    const rows = await tx
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .where(and(eq(tenantMemberships.tenantId, args.tenantId), eq(tenantMemberships.userId, args.userId), eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt)))
        .limit(1);
    return rows.length > 0;
}
