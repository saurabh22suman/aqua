import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { tenantMemberships, membershipLocations } from "@/db/schema/memberships";
import { roles, rolePermissions } from "@/db/schema/roles";
import { users } from "@/db/schema/users";
import { membershipPlans } from "@/db/schema/membership-plans";
import { locations } from "@/db/schema/locations";
import { facilities } from "@/db/schema/preset-engine";
import { members, persons } from "@/db/schema/people";
import { enrolments } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { asMemberId } from "@/lib/ids";
import { staff } from "@/db/schema/staff";
import type { ActionCtx } from "@/lib/auth/context";
import type { PlanRow } from "@/lib/services/membership-plans";
import { locationPredicate, locationVisible, resolveLocationAccess } from "@/lib/services/location-access";
import { isCoachLikeRoleKey } from "@/lib/services/resource-access";

// Bounded operational read: no settings access and no role-template fallback.
export async function listMemberSubscriptionPlans(ctx: ActionCtx, memberId: string): Promise<PlanRow[]> {
  if (!ctx.userId || !z.string().uuid().safeParse(ctx.userId).success || !z.string().uuid().safeParse(memberId).success) return [];
  return withTenant(ctx.tenantId, async (tx) => {
    // Recheck live principal, membership, role and grant in this same transaction.
    const [actor] = await tx.select({ membershipId: tenantMemberships.id, roleKey: roles.key })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantMemberships.tenantId)))
      .innerJoin(rolePermissions, and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.tenantId, roles.tenantId), eq(rolePermissions.permissionKey, "members.read")))
      .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.userId, ctx.userId!),
        eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt), isNull(users.deletedAt), isNull(roles.deletedAt)))
      .limit(1).for("share");
    if (!actor) return [];
    // Hold current named-facility rows until the read completes.
    await tx.select({ id: membershipLocations.id }).from(membershipLocations)
      .where(and(eq(membershipLocations.tenantId, ctx.tenantId), eq(membershipLocations.membershipId, actor.membershipId))).for("share");
    const liveCtx = { ...ctx, roleKey: actor.roleKey };
    // Evaluate the existing scope waterfall once. A concurrent configuration
    // change affects subsequent reads; it is not locked by this read.
    const access = await resolveLocationAccess(tx, liveCtx);
    // Keep the exact member and person live and in the evaluated facility
    // until the picker has been read. Scope is acquired before these locks.
    const [subject] = await tx.select({ locationId: members.locationId }).from(members)
      .innerJoin(persons, and(eq(persons.id, members.personId), eq(persons.tenantId, members.tenantId), isNull(persons.deletedAt)))
      .where(and(eq(members.tenantId, ctx.tenantId), eq(members.id, asMemberId(memberId)), isNull(members.deletedAt)))
      .limit(1).for("share");
    if (!subject || !locationVisible(access, subject.locationId)) return [];
    // Preserve visibleMember's coach/curriculum assignment boundary.
    if (isCoachLikeRoleKey(actor.roleKey)) {
      const [coach] = await tx.select({ id: staff.id }).from(staff)
        .where(and(eq(staff.tenantId, ctx.tenantId), eq(staff.userId, ctx.userId!),
          eq(staff.staffType, "coach"), isNull(staff.deletedAt))).limit(1).for("share");
      if (!coach) return [];
      const [assigned] = await tx.select({ id: enrolments.id }).from(enrolments)
        .innerJoin(batches, and(eq(batches.id, enrolments.batchId), eq(batches.tenantId, ctx.tenantId)))
        .where(and(eq(enrolments.tenantId, ctx.tenantId), eq(enrolments.memberId, asMemberId(memberId)),
          eq(batches.coachId, coach.id), isNull(batches.deletedAt))).limit(1).for("share");
      if (!assigned) return [];
    }
    const conditions = [eq(membershipPlans.tenantId, ctx.tenantId), eq(membershipPlans.isActive, true),
      isNull(membershipPlans.deletedAt), inArray(membershipPlans.kind, ["duration", "term", "sessions"])];
    const scope = locationPredicate(membershipPlans.locationId, access);
    if (scope) conditions.push(scope);
    const rows = await tx.select({ plan: membershipPlans, locationName: locations.name, activityName: facilities.name })
      .from(membershipPlans)
      .innerJoin(locations, and(eq(locations.id, membershipPlans.locationId), eq(locations.tenantId, ctx.tenantId)))
      .leftJoin(facilities, and(eq(facilities.id, membershipPlans.activityId), eq(facilities.tenantId, ctx.tenantId)))
      .where(and(...conditions)).orderBy(asc(locations.name), asc(facilities.name), asc(membershipPlans.name));
    return rows.map(({ plan, locationName, activityName }) => ({
      id: plan.id, name: plan.name, kind: plan.kind as PlanRow["kind"], durationDays: plan.durationDays,
      sessions: plan.sessions, amountPaise: Number(plan.amountPaise), locationId: plan.locationId,
      locationName, activityId: plan.activityId, activityName, isActive: plan.isActive,
      sourceShapeId: plan.sourceShapeId, createdAt: plan.createdAt.toISOString(),
    }));
  });
}
