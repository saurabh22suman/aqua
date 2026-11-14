import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { guardianships } from "@/db/schema/consent";
import { guardianChildLinks } from "@/db/schema/member-self";
import { members, persons } from "@/db/schema/people";
import { tenantMemberships } from "@/db/schema/memberships";
import { rolePermissions, roles } from "@/db/schema/roles";
import { users } from "@/db/schema/users";
import { writeAudit } from "@/lib/audit/write";
import type { ActionCtx } from "@/lib/auth/context";
import { readLinkAuthorities } from "@/lib/services/member-link-authority";
import { isFacilityScopedRoleKey } from "@/lib/services/facility-scope";

export type WithdrawGuardianResult =
  | { kind: "ok"; affectedLinkIds: string[] }
  | { kind: "error"; code: "not_found" | "invalid_request" | "busy"; message: string };
const absent = (): WithdrawGuardianResult => ({ kind: "error", code: "not_found", message: "Authorization not found." });
const invalid = (): WithdrawGuardianResult => ({ kind: "error", code: "invalid_request", message: "Confirm the change and give a reason." });

function retryable(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const item = current as { code?: unknown; cause?: unknown };
    if (item.code === "55P03" || item.code === "40P01" || item.code === "40001") return true;
    current = item.cause;
  }
  return false;
}

export async function withdrawGuardianAuthorization(ctx: ActionCtx, input: { guardianshipId: string; reason: string; confirmed: boolean }): Promise<WithdrawGuardianResult> {
  const parsed = z.object({ guardianshipId: z.string().uuid(), reason: z.string().trim().min(1).max(500), confirmed: z.literal(true) }).safeParse(input);
  if (!parsed.success || !ctx.userId) return invalid();
  const actor = ctx.userId;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTenant(ctx.tenantId, async (tx) => {
    const authority = (await readLinkAuthorities(tx, { tenantId: ctx.tenantId, userIds: [actor] })).get(actor);
    if (!authority?.live) return absent();
    const [identity] = await tx.select({ role: roles.key, roleId: roles.id }).from(tenantMemberships)
      .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantMemberships.tenantId), isNull(roles.deletedAt)))
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.userId, actor), eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt), isNull(users.deletedAt)))
      .limit(1).for("share", { of: users });
    if (!identity || (identity.role !== "owner" && !isFacilityScopedRoleKey(identity.role))) return absent();
    const [writeGrant] = await tx.select({ roleId: rolePermissions.roleId }).from(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, ctx.tenantId), eq(rolePermissions.roleId, identity.roleId), eq(rolePermissions.permissionKey, "members.write")))
      .limit(1).for("share");
    if (!writeGrant) return absent();
    // Preflight only identifies the lock target; authority and liveness are
    // checked again after acquiring all decision locks.
    const [preflight] = await tx.select({ minorId: guardianships.minorId }).from(guardianships)
      .where(and(eq(guardianships.tenantId, ctx.tenantId), eq(guardianships.id, parsed.data.guardianshipId), isNull(guardianships.deletedAt))).limit(1);
    if (!preflight) return absent();
    // UPDATE on the parent conflicts with FK KEY SHARE, preventing new member
    // rows for this person until the scope decision and mutation commit.
    const [person] = await tx.select({ id: persons.id }).from(persons)
      .where(and(eq(persons.tenantId, ctx.tenantId), eq(persons.id, preflight.minorId), isNull(persons.deletedAt)))
      .limit(1).for("update", { noWait: true });
    if (!person) return absent();
    const allChildMembers = await tx.select({ locationId: members.locationId, deletedAt: members.deletedAt }).from(members)
      .where(and(eq(members.tenantId, ctx.tenantId), eq(members.personId, person.id)))
      .orderBy(asc(members.id)).for("share", { noWait: true });
    const childMembers = allChildMembers.filter((member) => member.deletedAt === null);
    if (!childMembers.length || (!authority.unrestricted && childMembers.some((row) => !row.locationId || !authority.facilityIds.includes(row.locationId)))) return absent();
    await tx.select({ id: guardianChildLinks.id }).from(guardianChildLinks)
      .where(and(eq(guardianChildLinks.tenantId, ctx.tenantId), eq(guardianChildLinks.guardianshipId, parsed.data.guardianshipId)))
      .orderBy(asc(guardianChildLinks.id)).for("update", { noWait: true });
    const [relationship] = await tx.select({ id: guardianships.id, minorId: guardianships.minorId })
      .from(guardianships).where(and(eq(guardianships.tenantId, ctx.tenantId), eq(guardianships.id, parsed.data.guardianshipId), isNull(guardianships.deletedAt)))
      .limit(1).for("update", { noWait: true });
    if (!relationship || relationship.minorId !== person.id) return absent();
    // Re-read under a fresh READ COMMITTED snapshot; a link inserted since
    // the first scan must be locked without waiting or this attempt rolls back.
    await tx.select({ id: guardianChildLinks.id }).from(guardianChildLinks)
      .where(and(eq(guardianChildLinks.tenantId, ctx.tenantId), eq(guardianChildLinks.guardianshipId, relationship.id)))
      .orderBy(asc(guardianChildLinks.id)).for("update", { noWait: true });
    const now = new Date();
    await tx.update(guardianships).set({ deletedAt: now, updatedAt: now, updatedBy: actor })
      .where(and(eq(guardianships.tenantId, ctx.tenantId), eq(guardianships.id, relationship.id)));
    // Fresh statement snapshot also includes links enrolled while we waited for the relationship lock.
    const links = await tx.update(guardianChildLinks).set({ status: "revoked", revokedAt: now, revokedByUserId: actor, updatedAt: now, updatedBy: actor })
      .where(and(eq(guardianChildLinks.tenantId, ctx.tenantId), eq(guardianChildLinks.guardianshipId, relationship.id), inArray(guardianChildLinks.status, ["active", "invited"])))
      .returning({ id: guardianChildLinks.id });
    const affectedLinkIds = links.map((link) => link.id).sort();
    await writeAudit(tx, { tenantId: ctx.tenantId, actorId: actor, action: "guardianship.withdraw", entityType: "guardianship", entityId: relationship.id,
      after: { reason: parsed.data.reason, affectedLinkIds }, changedFields: ["deleted_at", "guardian_child_links.status"], requestId: ctx.requestId ?? null });
    return { kind: "ok", affectedLinkIds };
      });
    } catch (error) {
      if (!retryable(error)) throw error;
    }
  }
  return { kind: "error", code: "busy", message: "This authorization is being updated. Please try again." };
}
