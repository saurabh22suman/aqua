import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import { batches } from "@/db/schema/programs";
import { enrolments } from "@/db/schema/scheduling";
import { tenantMemberships } from "@/db/schema/memberships";
import { rolePermissions, roles } from "@/db/schema/roles";
import { users } from "@/db/schema/users";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";
import { coachStaffIdSubquery } from "./staff";
import { locationVisible, resolveLocationAccess } from "./location-access";

// R02 (2026-10-13 role-workflow audit) — the Curriculum Lead works the
// coach surface and must be scoped exactly like a coach: assigned
// batches, assigned learners, own register. `resourceRole` normalises
// the role key to "coach" for both so every existing assignment check
// keeps working without a second branch at each call site.
export function isCoachLikeRoleKey(roleKey: string | null | undefined): boolean {
  return roleKey === "coach" || roleKey === "curriculum_lead";
}

// Service calls retain authenticated resource context. System callers must
// identify themselves explicitly; missing identity is not system authority.
export async function resourceRole(tx: TenantTx, ctx: ActionCtx): Promise<string | null> {
  if (!ctx.userId) return null;
  const [membership] = await tx.select({ key: roles.key }).from(tenantMemberships)
    .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, ctx.tenantId)))
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.userId, ctx.userId),
      eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt), isNull(roles.deletedAt), isNull(users.deletedAt)))
    .orderBy(asc(roles.homeOrdinal), asc(tenantMemberships.createdAt)).limit(1);
  return isCoachLikeRoleKey(membership?.key) ? "coach" : membership?.key ?? null;
}

// A system caller opts in explicitly and has no human identity or role
// claims. Incomplete human contexts never gain system authority.
export function callerIsLegacySystem(ctx: ActionCtx): boolean {
  return ctx.systemActor === true && !ctx.userId && !ctx.roleKey && !ctx.permissions;
}

export async function callerHasPermission(
  tx: TenantTx,
  ctx: ActionCtx,
  permissionKey: string,
): Promise<boolean> {
  if (!ctx.userId) return false;
  // Request context may narrow authority, never supply or revive a grant.
  if (ctx.permissions && !ctx.permissions.has(permissionKey)) return false;
  const [row] = await tx
    .select({ key: rolePermissions.permissionKey })
    .from(tenantMemberships)
    .innerJoin(
      roles,
      and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, ctx.tenantId)),
    )
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(
      rolePermissions,
      and(
        eq(rolePermissions.roleId, roles.id),
        eq(rolePermissions.tenantId, ctx.tenantId),
      ),
    )
    .where(
      and(
        eq(tenantMemberships.tenantId, ctx.tenantId),
        eq(tenantMemberships.userId, ctx.userId),
        eq(tenantMemberships.status, "active"),
        isNull(tenantMemberships.deletedAt),
        isNull(roles.deletedAt),
        isNull(users.deletedAt),
        eq(rolePermissions.permissionKey, permissionKey),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function visibleMember(tx: TenantTx, ctx: ActionCtx, memberId: string) {
  const [row] = await tx.select({ member: members }).from(members)
    .innerJoin(persons, and(eq(persons.id, members.personId), eq(persons.tenantId, ctx.tenantId)))
    .where(and(eq(members.tenantId, ctx.tenantId), eq(members.id, asMemberId(memberId)),
      isNull(members.deletedAt), isNull(persons.deletedAt))).limit(1);
  const member = row?.member;
  if (!member || !locationVisible(await resolveLocationAccess(tx, ctx), member.locationId)) return null;
  if (await resourceRole(tx, ctx) === "coach") {
    const [assigned] = await tx.select({ id: enrolments.id }).from(enrolments)
      .innerJoin(batches, and(eq(batches.id, enrolments.batchId), eq(batches.tenantId, ctx.tenantId)))
      .where(and(eq(enrolments.tenantId, ctx.tenantId), eq(enrolments.memberId, member.id),
        eq(batches.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)), isNull(batches.deletedAt))).limit(1);
    if (!assigned) return null;
  }
  return member;
}

export async function visibleBatch(tx: TenantTx, ctx: ActionCtx, batchId: string) {
  const [batch] = await tx.select().from(batches).where(and(
    eq(batches.tenantId, ctx.tenantId), eq(batches.id, batchId), isNull(batches.deletedAt))).limit(1);
  if (!batch || !locationVisible(await resolveLocationAccess(tx, ctx), batch.locationId)) return null;
  if (await resourceRole(tx, ctx) === "coach") {
    const [assigned] = await tx.select({ id: batches.id }).from(batches).where(and(
      eq(batches.id, batch.id), eq(batches.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)))).limit(1);
    if (!assigned) return null;
  }
  return batch;
}
