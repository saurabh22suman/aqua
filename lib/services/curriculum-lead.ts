import { and, eq, isNull } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { staff } from "@/db/schema/staff";
import { membershipLocations, tenantMemberships } from "@/db/schema/memberships";
import { roles } from "@/db/schema/roles";
import { locations } from "@/db/schema/locations";
import { writeAudit } from "@/lib/audit/write";
import type { ActionCtx } from "@/lib/auth/context";
import { asStaffId } from "@/lib/ids";

// R02 (2026-10-13 role-workflow audit) — delegated curriculum
// maintenance.
//
// The academy has exactly one narrow curriculum capability
// (`levels.write`). It lives on a distinct system role
// (`curriculum_lead`, seeded per tenant) rather than on the shared
// coach role or `settings.manage`. This service is the owner-controlled
// designation: it swaps a coach's membership role between the system
// `coach` and `curriculum_lead` roles, preserving the staff row,
// person, user identity, membership and its location list. Removal
// swaps it back.
//
// Scope statement (do not over-claim): frameworks are academy-wide —
// the delegated capability is not isolated per activity or batch.
// Resource access (register, assigned learners) stays coach-scoped
// because the role keeps the coach surface and coach-like resource
// checks.

const COACH_ROLE_KEYS = new Set(["coach", "curriculum_lead"]);

export type CurriculumLeadState = {
  eligible: boolean;
  isLead: boolean;
  reason: string | null;
  locationNames: string[];
};

export type CurriculumLeadResult =
  | { kind: "ok"; isLead: boolean }
  | {
      kind: "error";
      code:
        | "invalid"
        | "not_found"
        | "not_coach"
        | "no_login"
        | "membership_inactive"
        | "role_missing"
        | "not_delegatable";
      message: string;
    };

type DelegationTarget = {
  staffType: string;
  userId: string | null;
  membership:
    | {
        membershipId: string;
        status: string;
        roleKey: string;
        roleIsSystem: boolean;
      }
    | null;
};

async function loadDelegationTarget(
  tx: TenantTx,
  tenantId: ActionCtx["tenantId"],
  staffId: string,
): Promise<DelegationTarget | null> {
  const [row] = await tx
    .select({ staffType: staff.staffType, userId: staff.userId })
    .from(staff)
    .where(
      and(
        eq(staff.tenantId, tenantId),
        eq(staff.id, asStaffId(staffId)),
        isNull(staff.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  if (!row.userId) {
    return { staffType: row.staffType, userId: null, membership: null };
  }

  const [membership] = await tx
    .select({
      membershipId: tenantMemberships.id,
      status: tenantMemberships.status,
      roleKey: roles.key,
      roleIsSystem: roles.isSystem,
    })
    .from(tenantMemberships)
    .innerJoin(
      roles,
      and(
        eq(roles.id, tenantMemberships.roleId),
        eq(roles.tenantId, tenantMemberships.tenantId),
      ),
    )
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.userId, row.userId),
        isNull(tenantMemberships.deletedAt),
      ),
    )
    .limit(1);

  return {
    staffType: row.staffType,
    userId: row.userId,
    membership: membership ?? null,
  };
}

export async function getCurriculumLeadState(
  ctx: ActionCtx,
  staffId: string,
): Promise<CurriculumLeadState> {
  return withTenant(ctx.tenantId, async (tx) => {
    const target = await loadDelegationTarget(tx, ctx.tenantId, staffId);
    if (!target) {
      return { eligible: false, isLead: false, reason: "Staff member not found.", locationNames: [] };
    }
    if (target.staffType !== "coach") {
      return { eligible: false, isLead: false, reason: "Only a coach can be the curriculum lead.", locationNames: [] };
    }
    if (!target.userId) {
      return { eligible: false, isLead: false, reason: "This coach has no login yet.", locationNames: [] };
    }
    if (!target.membership || target.membership.status === "revoked") {
      return { eligible: false, isLead: false, reason: "Membership is not active.", locationNames: [] };
    }
    if (!target.membership.roleIsSystem || !COACH_ROLE_KEYS.has(target.membership.roleKey)) {
      return { eligible: false, isLead: false, reason: "This membership uses a custom role.", locationNames: [] };
    }
    const locationNames = (
      await tx
        .select({ name: locations.name })
        .from(membershipLocations)
        .innerJoin(locations, eq(locations.id, membershipLocations.locationId))
        .where(
          and(
            eq(membershipLocations.tenantId, ctx.tenantId),
            eq(membershipLocations.membershipId, target.membership.membershipId),
          ),
        )
    ).map((l) => l.name);
    return {
      eligible: true,
      isLead: target.membership.roleKey === "curriculum_lead",
      reason: null,
      locationNames,
    };
  });
}

export async function setCurriculumLead(
  ctx: ActionCtx,
  staffId: string,
  enabled: boolean,
): Promise<CurriculumLeadResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const target = await loadDelegationTarget(tx, ctx.tenantId, staffId);
    if (!target) {
      return { kind: "error", code: "not_found", message: "Staff member not found." };
    }
    if (target.staffType !== "coach") {
      return { kind: "error", code: "not_coach", message: "Only a coach can be the curriculum lead." };
    }
    if (!target.userId) {
      return { kind: "error", code: "no_login", message: "This coach has no login yet — invite them first." };
    }
    const membership = target.membership;
    if (!membership || membership.status === "revoked") {
      return { kind: "error", code: "membership_inactive", message: "Reactivate this membership before delegating." };
    }
    if (!membership.roleIsSystem || !COACH_ROLE_KEYS.has(membership.roleKey)) {
      return {
        kind: "error",
        code: "not_delegatable",
        message: "This membership uses a custom role; change it on the invitations board instead.",
      };
    }

    const [targetRole] = await tx
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(
        and(
          eq(roles.tenantId, ctx.tenantId),
          eq(roles.key, enabled ? "curriculum_lead" : "coach"),
          eq(roles.isSystem, true),
          isNull(roles.deletedAt),
        ),
      )
      .limit(1);
    if (!targetRole) {
      return { kind: "error", code: "role_missing", message: "The seeded role is missing for this academy." };
    }

    if (membership.roleKey === targetRole.key) {
      return { kind: "ok", isLead: enabled };
    }

    await tx
      .update(tenantMemberships)
      .set({ roleId: targetRole.id, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(tenantMemberships.id, membership.membershipId),
          eq(tenantMemberships.tenantId, ctx.tenantId),
        ),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorType: ctx.userId ? "user" : "system",
      requestId: ctx.requestId,
      action: "membership.role_change",
      entityType: "tenant_membership",
      entityId: membership.membershipId,
      before: { roleKey: membership.roleKey },
      after: {
        roleKey: targetRole.key,
        reason: enabled ? "curriculum_lead_designated" : "curriculum_lead_removed",
      },
      changedFields: ["role_id"],
    });

    return { kind: "ok", isLead: enabled };
  });
}
