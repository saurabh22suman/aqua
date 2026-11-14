import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { z } from "zod";
import { users } from "@/db/schema/users";
import { tenantMemberships, membershipLocations } from "@/db/schema/memberships";
import { roles, rolePermissions } from "@/db/schema/roles";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";
import { members } from "@/db/schema/people";
import { batches } from "@/db/schema/programs";
import type { ActionCtx } from "@/lib/auth/context";

// Phase 2.8 — onboarding checklist. The new tenant's owner needs
// to see what's left to set up after the wizard lands them:
// members to add, batches to schedule, coaches to assign. Each
// item is computed from real data — nothing here is stored
// separately — so the checklist can never drift from the actual
// state of the tenant.
//
// The items themselves are fixed in code at this phase; branding
// and terminology land with 2.9/2.10, location-management lands
// with F-23 (Settings). Each new phase that adds a real setup
// step appends its item here. The order is the order a new owner
// would naturally follow.
export type OnboardingItemKey = "add_members" | "create_batch" | "assign_coach";

export type OnboardingItem = {
  key: OnboardingItemKey;
  title: string;
  detail: string;
  cta?: { label: string; href: string };
  // PR2-C7 — an alternative way to finish the step (today: importing
  // an existing register instead of adding members one by one).
  secondaryCta?: { label: string; href: string };
  complete: boolean;
};

export type OnboardingChecklist = {
  items: OnboardingItem[];
  completedCount: number;
  totalCount: number;
  // Any facility-list answer is bounded to returned records, even a tenant-wide
  // manager whose current live-facility list excludes soft-deleted facilities.
  // Display only: this flag never authorizes or narrows a read.
  scopeIsLimited?: boolean;
};

// "Assign coaches" is the third item. The check is intentionally
// the *narrow* one — a batch actually has a coach assigned, not
// just that a coach-staff row exists somewhere in the system —
// because a present-but-unassigned coach is still work the owner
// has left to do. If `staff` is empty AND no batch has a coach,
// the item is incomplete.
const ITEMS: ReadonlyArray<{
  key: OnboardingItemKey;
  title: string;
  detail: string;
  cta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}> = [
  {
    key: "add_members",
    title: "Add your first member",
    detail: "The register and history both start with members.",
    cta: { label: "Add a member", href: "/owner/members/new" },
    secondaryCta: { label: "Import a CSV", href: "/owner/members/import" },
  },
  {
    key: "create_batch",
    title: "Create a batch",
    detail: "Batches are the slots members register against — sessions, attendance and reports all read from them.",
    cta: { label: "Create a batch", href: "/owner/programs" },
  },
  {
    key: "assign_coach",
    title: "Assign a coach to a batch",
    detail: "An unassigned batch has no coach for the register view to show. Pick a coach on the batch card.",
    cta: { label: "Assign a coach", href: "/owner/programs" },
  },
];

export async function getOnboardingChecklist(
  ctx: ActionCtx & { features?: Set<string> },
): Promise<OnboardingChecklist> {
  const empty: OnboardingChecklist = { items: [], completedCount: 0, totalCount: 0, scopeIsLimited: true };
  if (!ctx.userId || !z.string().uuid().safeParse(ctx.userId).success) return empty;
  return withTenant(ctx.tenantId, async (tx) => {
    const [actor] = await tx.select({ membershipId: tenantMemberships.id, roleId: roles.id, roleKey: roles.key })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantMemberships.tenantId)))
      .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.userId, ctx.userId!),
        eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt), isNull(roles.deletedAt), isNull(users.deletedAt)))
      .limit(1).for("share");
    if (!actor) return empty;
    const grants = await tx.select({ key: rolePermissions.permissionKey }).from(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, ctx.tenantId), eq(rolePermissions.roleId, actor.roleId))).for("share");
    const has = (key: string) => grants.some((g) => g.key === key) && (!ctx.permissions || ctx.permissions.has(key));
    // All three modules are always-on in the permission resolver. An
    // explicit request feature set can narrow this internal read.
    const enabled = (key: string) => !ctx.features || ctx.features.has(key);
    if (!has("members.read") || !enabled("members")) return empty;
    await tx.select({ id: membershipLocations.id }).from(membershipLocations)
      .where(and(eq(membershipLocations.tenantId, ctx.tenantId), eq(membershipLocations.membershipId, actor.membershipId))).for("share");
    // The existing scope waterfall is evaluated once. Later configuration
    // changes apply to later reads; this does not claim a configuration lock.
    const access = await resolveLocationAccess(tx, { ...ctx, roleKey: actor.roleKey });
    if (!access.unrestricted && access.denied) return empty;
    const memberScope = locationPredicate(members.locationId, access);
    const batchScope = locationPredicate(batches.locationId, access);
    const [{ n: memberCount }] = await tx.select({ n: sql<number>`count(*)::int` }).from(members)
      .where(and(eq(members.tenantId, ctx.tenantId), isNull(members.deletedAt), memberScope));
    let batchCount = 0, batchWithCoachCount = 0;
    if (has("programs.read") && enabled("programs")) {
      const [counts] = await tx.select({ n: sql<number>`count(*)::int`, assigned: sql<number>`count(*) filter (where ${batches.coachId} is not null)::int` })
        .from(batches).where(and(eq(batches.tenantId, ctx.tenantId), isNull(batches.deletedAt), batchScope));
      batchCount = counts.n; batchWithCoachCount = counts.assigned;
    }
    const completion: Record<OnboardingItemKey, boolean> = {
      add_members: memberCount > 0, create_batch: batchCount > 0, assign_coach: batchWithCoachCount > 0,
    };
    // The programs destination additionally reads staff and member locations;
    // the write grant controls whether its batch actions are offered.
    const canMembers = has("members.write");
    const canBatches = has("programs.read") && has("programs.write") && has("staff.read") && enabled("programs") && enabled("staff");
    const items: OnboardingItem[] = ITEMS.filter((item) => item.key === "add_members" || (has("programs.read") && enabled("programs")))
      .map((item) => {
        const allowed = item.key === "add_members" ? canMembers : canBatches;
        return { key: item.key, title: item.title, detail: item.detail, complete: completion[item.key],
          ...(allowed ? { cta: item.cta, ...(item.secondaryCta ? { secondaryCta: item.secondaryCta } : {}) } : {}) };
      });
    return { items, completedCount: items.filter((item) => item.complete).length, totalCount: items.length,
      scopeIsLimited: !access.unrestricted };
  });
}
