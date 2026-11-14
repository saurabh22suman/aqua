import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { enrollmentAccountByPhoneInTx } from "@/db/member-enrollment-account";
import { guardianships } from "@/db/schema/consent";
import { tenantMemberships } from "@/db/schema/memberships";
import { users } from "@/db/schema/users";
import { writeAudit } from "@/lib/audit/write";
import { members, persons } from "@/db/schema/people";
import { rolePermissions, roles } from "@/db/schema/roles";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId, asUserId } from "@/lib/ids";
import { normaliseToE164 } from "@/lib/phone";
import { isFacilityScopedRoleKey } from "@/lib/services/facility-scope";
import { readLinkAuthorities } from "@/lib/services/member-link-authority";
import { provisionMemberAccountLinkInTx, type LinkAudience, type ProvisionResult } from "@/lib/services/member-link-binding";

function notFound(): ProvisionResult {
  return { kind: "error", code: "not_found", message: "No such link." };
}

class EnrollmentRefused extends Error {}

/** Enrol exactly one member or one existing guardianship using the named phone. */
export async function enrollMemberSignIn(
  ctx: ActionCtx,
  input: { audience: LinkAudience; memberId: string; guardianshipId?: string; phone: string },
): Promise<ProvisionResult> {
  const phone = normaliseToE164(input.phone);
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || !ctx.userId) return notFound();
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      // Lock and authorize the subject before the global phone lookup. The
      // inner provision repeats these checks before writing the link.
      const actorRoles = await tx.select({ key: roles.key, roleId: roles.id }).from(tenantMemberships)
        .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantMemberships.tenantId), isNull(roles.deletedAt)))
        .innerJoin(users, and(eq(users.id, tenantMemberships.userId), isNull(users.deletedAt)))
        .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.userId, asUserId(ctx.userId!)), eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt))).limit(1).for("share");
      const roleKey = actorRoles[0]?.key;
      if (roleKey !== "owner" && !isFacilityScopedRoleKey(roleKey)) throw new EnrollmentRefused();
      const writeGrant = await tx.select({ roleId: rolePermissions.roleId }).from(rolePermissions)
        .where(and(eq(rolePermissions.tenantId, ctx.tenantId), eq(rolePermissions.roleId, actorRoles[0]!.roleId), eq(rolePermissions.permissionKey, "members.write"))).limit(1).for("share");
      if (!writeGrant[0]) throw new EnrollmentRefused();
      const rows = await tx.select({ personId: members.personId, locationId: members.locationId })
        .from(members).innerJoin(persons, and(eq(persons.id, members.personId), eq(persons.tenantId, members.tenantId), isNull(persons.deletedAt)))
        .where(and(eq(members.tenantId, ctx.tenantId), eq(members.id, asMemberId(input.memberId)), isNull(members.deletedAt))).limit(1).for("share");
      const subject = rows[0];
      const authority = (await readLinkAuthorities(tx, { tenantId: ctx.tenantId, userIds: [ctx.userId!] })).get(ctx.userId!);
      if (!subject || !authority?.live || (!authority.unrestricted && (!subject.locationId || !authority.facilityIds.includes(subject.locationId)))) throw new EnrollmentRefused();
      if (input.audience === "guardian") {
        if (!input.guardianshipId) throw new EnrollmentRefused();
        const guardian = await tx.select({ id: guardianships.id }).from(guardianships)
          .innerJoin(persons, and(eq(persons.id, guardianships.guardianId), eq(persons.tenantId, guardianships.tenantId), isNull(persons.deletedAt)))
          .where(and(eq(guardianships.id, input.guardianshipId), eq(guardianships.tenantId, ctx.tenantId), eq(guardianships.minorId, subject.personId), isNull(guardianships.deletedAt))).limit(1).for("share");
        if (!guardian[0]) throw new EnrollmentRefused();
      }
      const account = await enrollmentAccountByPhoneInTx(tx, phone);
      if (!account) throw new EnrollmentRefused();
      const result = await provisionMemberAccountLinkInTx(tx, ctx, { ...input, accountUserId: account.id });
      // Throw, rather than return, so a newly inserted account rolls back on
      // duplicate link or any other refusal in the same transaction.
      if (result.kind !== "ok") throw new EnrollmentRefused();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorType: "user",
        actorId: ctx.userId!,
        action: "member.access.enroll",
        entityType: input.audience === "member" ? "member" : "guardianship",
        entityId: input.audience === "member" ? input.memberId : input.guardianshipId!,
        after: { accountUserId: account.id, linkId: result.linkId, audience: input.audience, accountCreated: account.created },
        changedFields: ["accountUserId", "linkId"],
        requestId: ctx.requestId ?? null,
      });
      return result;
    });
  } catch (error) {
    if (error instanceof EnrollmentRefused) return notFound();
    throw error;
  }
}
