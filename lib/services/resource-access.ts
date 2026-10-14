import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import { batches } from "@/db/schema/programs";
import { enrolments } from "@/db/schema/scheduling";
import { tenantMemberships } from "@/db/schema/memberships";
import { rolePermissions, roles } from "@/db/schema/roles";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";
import { coachStaffIdSubquery } from "./staff";
import { roleTemplatePermissionKeys } from "./roles";
import { locationVisible, resolveLocationAccess } from "./location-access";

// R02 (2026-10-13 role-workflow audit) — the Curriculum Lead works the
// coach surface and must be scoped exactly like a coach: assigned
// batches, assigned learners, own register. `resourceRole` normalises
// the role key to "coach" for both so every existing assignment check
// keeps working without a second branch at each call site.
export function isCoachLikeRoleKey(roleKey: string | null | undefined): boolean {
  return roleKey === "coach" || roleKey === "curriculum_lead";
}

// Service calls retain the authenticated resource context. Identity-free
// contexts are deliberate internal/system callers, never action adapters.
export async function resourceRole(tx: TenantTx, ctx: ActionCtx): Promise<string | null> {
  if (ctx.roleKey) return isCoachLikeRoleKey(ctx.roleKey) ? "coach" : ctx.roleKey;
  if (!ctx.userId) return null;
  const [membership] = await tx.select({ key: roles.key }).from(tenantMemberships)
    .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, ctx.tenantId)))
    .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.userId, ctx.userId),
      eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt)))
    .orderBy(asc(roles.homeOrdinal), asc(tenantMemberships.createdAt)).limit(1);
  return isCoachLikeRoleKey(membership?.key) ? "coach" : membership?.key ?? null;
}

// A caller that arrives through a Server Action always carries the
// request-resolved permission set. A caller with a role key but no
// permission set is a synthetic/legacy service caller whose role
// template is the seed contract. A caller with an actor id but no role
// context at all is a pre-context internal/system call (older service
// fixtures); the action layer remains the authorization boundary, so
// services accept it but must still enforce resource scope. A caller
// with neither actor nor role is refused.
export function callerIsLegacySystem(ctx: ActionCtx): boolean {
  return !ctx.roleKey && !ctx.permissions;
}

export async function callerHasPermission(
  tx: TenantTx,
  ctx: ActionCtx,
  permissionKey: string,
): Promise<boolean> {
  // An authoritative resolved set wins even when it LACKS the key: a
  // tenant may revoke a template permission from an edited role, and
  // falling through to the template would silently restore it.
  if (ctx.permissions) return ctx.permissions.has(permissionKey);
  if (ctx.roleKey) {
    const template = roleTemplatePermissionKeys(ctx.roleKey);
    if (template) return template.has(permissionKey);
  }
  if (!ctx.userId) return false;
  const [row] = await tx
    .select({ key: rolePermissions.permissionKey })
    .from(tenantMemberships)
    .innerJoin(
      roles,
      and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, ctx.tenantId)),
    )
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
