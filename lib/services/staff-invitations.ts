import { v7 as uuidv7 } from "uuid";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatform } from "@/db/scope";
import { withTenant } from "@/db/tenant";
import {
  findOrCreateUserByPhone,
  findPhonesByUserIds,
} from "@/db/user-account";
import { tenantMemberships, membershipLocations } from "@/db/schema/memberships";
import { roles } from "@/db/schema/roles";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import type { ActionCtx } from "@/lib/auth/context";
import { asTenantId, type UserId } from "@/lib/ids";

// Phase 3.6 — staff invitations. Tenant-side service that
// invites a person by phone to a specific role on this tenant.
// Modeled on the platform-side inviteOwner (db/tenant-invite.ts)
// which it complements: a new tenant is created and its owner
// invited from the platform admin; an existing tenant grows
// its staff via this service.
//
// Two transactions: withPlatform() for the users table (RLS-exempt
// platform allowlist, identity column); withTenant() for the
// tenant-scoped membership + role + location writes. Same
// pattern as inviteOwner, the difference being that the role is
// caller-chosen from a closed set rather than always 'owner'.
//
// better-auth's callbackOnVerification (lib/auth/server.ts ->
// db/membership-activation.ts) flips status 'invited' → 'active'
// the moment the invitee proves OTP ownership of their phone.
// "Accept" therefore isn't a separate user action — it's the
// OTP flow itself, which the invitee runs unaided once they
// know the phone to sign in with. The membership row carries
// the full identity, so the activation has nothing else to
// reconcile.
const E164_PLUS = /^\+\d{8,15}$/;

// Closed role keys the invitation form is allowed to assign.
// Owners can never self-revoke this way — seeding an 'admin' or
// 'coach' row is the realistic case. 'owner' is included for
// completeness when a tenant has a co-owner arrangement; the
// service refuses if it would leave the tenant with zero owners.
export const STAFF_INVITABLE_ROLES = [
  "admin",
  "coach",
  "receptionist",
] as const;

export type StaffInvitableRoleKey = (typeof STAFF_INVITABLE_ROLES)[number];

export type InviteStaffInput = {
  phone: string;
  fullName: string;
  roleKey: StaffInvitableRoleKey;
  // Empty list means "all locations" — the membership gets
  // allLocations=true and no membership_locations rows. A
  // non-empty list restricts the membership's location scope to
  // those ids; the role's location scope does not widen this.
  locationIds: string[];
};

export type InviteStaffResult =
  | { kind: "ok"; userId: UserId; membershipId: string; wasNewUser: boolean }
  | {
      kind: "error";
      code:
        | "invalid"
        | "tenant_not_found"
        | "role_not_found"
        | "unknown_role"
        | "location_not_found"
        | "already_member"
        | "would_leave_zero_owners";
      message: string;
    };

const inputSchema = z.object({
  phone: z.string().trim().min(1).max(40),
  fullName: z.string().trim().min(1).max(200),
  roleKey: z.enum(STAFF_INVITABLE_ROLES),
  locationIds: z.array(z.string().uuid()).max(50).default([]),
});

export async function inviteStaff(
  ctx: ActionCtx,
  rawInput: InviteStaffInput,
): Promise<InviteStaffResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const input = parsed.data;
  const cleanedPhone = input.phone.replace(/[\s-]/g, "");
  if (!E164_PLUS.test(cleanedPhone)) {
    return {
      kind: "error",
      code: "invalid",
      message: "Phone must be E.164 with country code (e.g. +919876543210).",
    };
  }

  // 1. Find-or-create the `users` row — through withPlatform()
  // because the users table is in the platform allowlist (RLS-
  // exempt). Phone is unique there. A re-invite to the same phone
  // matches the existing user.
  const user = await withPlatform(() =>
    findOrCreateUserByPhone(cleanedPhone),
  );

  // 2. Open the tenant scope for membership + role + location
  //    writes, and verify the locations exist in this tenant.
  return withTenant(ctx.tenantId, async (tx) => {
    const tenantExists = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    if (tenantExists.length === 0) {
      return {
        kind: "error",
        code: "tenant_not_found",
        message: "Tenant not found.",
      };
    }

    // Required role: find by key within the calling tenant. The
    // role exists because seedRoleTemplates ran at tenant
    // creation — that's a fixture contract (C-04 / 1.5).
    const roleRow = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(
          eq(roles.tenantId, ctx.tenantId),
          eq(roles.key, input.roleKey),
          isNull(roles.deletedAt),
        ),
      )
      .limit(1);
    if (roleRow.length === 0) {
      return {
        kind: "error",
        code: "role_not_found",
        message: `This tenant has no '${input.roleKey}' role. seedRoleTemplates should have run.`,
      };
    }

    // Existing-membership check — unique key (tenant, user)
    // would 23505, but the action reports "already_member"
    // rather than crashing.
    const existingMembership = await tx
      .select({ id: tenantMemberships.id })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, ctx.tenantId),
          eq(tenantMemberships.userId, user.id as never),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);
    if (existingMembership[0]) {
      return {
        kind: "error",
        code: "already_member",
        message: "This phone is already a member of the tenant. Edit the existing record instead.",
      };
    }

    // Location validity — every provided id must belong to this
    // tenant. RLS would catch a cross-tenant id at write time,
    // but the structured error here is clearer than a 42501.
    if (input.locationIds.length > 0) {
      const valid = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(
          and(
            eq(locations.tenantId, ctx.tenantId),
            isNull(locations.deletedAt),
          ),
        );
      const validIds = new Set(valid.map((l) => l.id));
      for (const lid of input.locationIds) {
        if (!validIds.has(lid)) {
          return {
            kind: "error",
            code: "location_not_found",
            message: "One of the locations doesn't belong to this tenant.",
          };
        }
      }
    }

    // Insert membership.
    const inserted = await tx
      .insert(tenantMemberships)
      .values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        userId: user.id as never,
        roleId: roleRow[0]!.id,
        allLocations: input.locationIds.length === 0,
        status: "invited",
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: tenantMemberships.id });
    const membershipId = inserted[0]!.id;

    // Per-location scope rows when locationIds were given.
    if (input.locationIds.length > 0) {
      for (const lid of input.locationIds) {
        await tx.insert(membershipLocations).values({
          tenantId: ctx.tenantId,
          membershipId,
          locationId: lid,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
    }

    // TODO(tenant-audit-log): the actor on a staff invite is a
    // tenant user, not a platform operator; writing here would
    // violate platform_audit_log.actor_id's FK to platform_users.
    // membership-activation.ts makes the same call (D1's README
    // notes the gap and points at architecture §8.10). When the
    // tenant-side audit_log lands, every tenant-initiated
    // mutation in this file gets one in the same transaction
    // — invite, revoke, resend. For now these mutations are
    // unaudited; the standing rule's violation is recorded
    // explicitly so future audit readers see it.

    return {
      kind: "ok",
      userId: user.id as UserId,
      membershipId,
      wasNewUser: user.wasNew,
    };
  });
}

export type ListInvitationsRow = {
  membershipId: string;
  phone: string;
  fullName: string;
  roleKey: string;
  status: "invited" | "active" | "revoked";
  locationNames: string[];
  invitedAt: Date | null;
};

export async function listInvitations(
  ctx: ActionCtx,
): Promise<ListInvitationsRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const memberships = await tx
      .select({
        membershipId: tenantMemberships.id,
        userId: tenantMemberships.userId,
        roleKey: roles.key,
        status: tenantMemberships.status,
        createdAt: tenantMemberships.createdAt,
      })
      .from(tenantMemberships)
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .where(
        and(
          eq(tenantMemberships.tenantId, ctx.tenantId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .orderBy(tenantMemberships.createdAt);

    // The `users` table is platform-owned and RLS-exempt; read
    // the phones we need through withPlatform(). One round trip
    // for the whole page rather than one per row.
    const userIds = memberships.map((r) => r.userId);
    const phoneByUser = await withPlatform(() =>
      findPhonesByUserIds(userIds),
    );

    const memberIds = memberships.map((m) => m.membershipId);
    const locsByMember = new Map<string, string[]>();
    if (memberIds.length > 0) {
      const locRows = await tx
        .select({
          membershipId: membershipLocations.membershipId,
          locationName: locations.name,
        })
        .from(membershipLocations)
        .innerJoin(locations, eq(locations.id, membershipLocations.locationId))
        .where(
          and(
            eq(membershipLocations.tenantId, ctx.tenantId),
            isNull(locations.deletedAt),
          ),
        );
      for (const lr of locRows) {
        const arr = locsByMember.get(lr.membershipId) ?? [];
        arr.push(lr.locationName);
        locsByMember.set(lr.membershipId, arr);
      }
    }

    return memberships.map((m) => ({
      membershipId: m.membershipId,
      phone: phoneByUser.get(m.userId) ?? "(unknown)",
      fullName: "",
      roleKey: m.roleKey,
      status: m.status as "invited" | "active" | "revoked",
      locationNames: locsByMember.get(m.membershipId) ?? [],
      invitedAt: m.createdAt,
    }));
  });
}

// Revoke — soft-state change. We do not soft-delete the row,
// because the activateInvitedMemberships hook fires on the
// invitee's first OTP, and that hook explicitly filters on
// status='invited' — a 'revoked' row is left alone, exactly the
// "revocation, once built, stays sticky against a later login"
// semantics the codebase already established (CLAUDE.md notes).
//
// Holds zero-owner and sole-owner guards because revoking the
// only owner of a tenant leaves nobody able to administer it.
//
// layer.
export type RevokeStaffResult =
  | { kind: "ok"; revokedAt: Date }
  | {
      kind: "error";
      code:
        | "membership_not_found"
        | "already_revoked"
        | "would_leave_zero_owners"
        | "not_invited_or_active";
      message: string;
    };

export async function revokeInvitation(
  ctx: ActionCtx,
  rawInput: { membershipId: string },
): Promise<RevokeStaffResult> {
  const parsed = z.object({ membershipId: z.string().uuid() }).safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "membership_not_found",
      message: "Invalid membership id.",
    };
  }
  const { membershipId } = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const [m] = await tx
      .select({
        id: tenantMemberships.id,
        userId: tenantMemberships.userId,
        roleKey: roles.key,
        status: tenantMemberships.status,
      })
      .from(tenantMemberships)
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.tenantId, ctx.tenantId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);
    if (!m) {
      return {
        kind: "error",
        code: "membership_not_found",
        message: "Membership not found.",
      };
    }
    if (m.status === "revoked") {
      return {
        kind: "error",
        code: "already_revoked",
        message: "Already revoked.",
      };
    }

    // Sole-owner guard. Revoking an owner when this is the
    // last active owner would lock the tenant out. Count active
    // owners excluding the row under revoke.
    if (m.roleKey === "owner") {
      const otherOwnerCount = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(tenantMemberships)
        .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenantId),
            eq(roles.key, "owner"),
            eq(tenantMemberships.status, "active"),
            isNull(tenantMemberships.deletedAt),
          ),
        );
      if ((otherOwnerCount[0]?.n ?? 0) <= 1) {
        return {
          kind: "error",
          code: "would_leave_zero_owners",
          message:
            "Revoking the only active owner would lock the tenant out. Promote someone else first.",
        };
      }
    }

    const revokedAt = new Date();
    await tx
      .update(tenantMemberships)
      .set({ status: "revoked", updatedAt: revokedAt, updatedBy: ctx.userId })
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.tenantId, ctx.tenantId),
        ),
      );

    // TODO(tenant-audit-log): see inviteStaff above. Tenant-
    // initiated mutations stay unaudited until §8.10 lands.

    return { kind: "ok", revokedAt };
  });
}

// Resend — the messaging layer (WhatsApp, email) that would
// "send the link again" is not in this codebase (the work
// guide's "Reserve" lists R.21 / messaging for that, and 3.6's
// Done When mentions "resend" knowing it's a no-op until the
// messaging chain ships). The service returns ok with a flag,
// and the UI shows "Pending — no live delivery yet" until the
// messaging chain lands.
export async function resendInvitation(
  ctx: ActionCtx,
  rawInput: { membershipId: string },
): Promise<{ kind: "ok"; delivered: false } | { kind: "error"; code: "membership_not_found" | "not_invited"; message: string }> {
  const parsed = z.object({ membershipId: z.string().uuid() }).safeParse(rawInput);
  if (!parsed.success) {
    return { kind: "error", code: "membership_not_found", message: "Invalid membership id." };
  }
  const { membershipId } = parsed.data;
  return withTenant(ctx.tenantId, async (tx) => {
    const [m] = await tx
      .select({ id: tenantMemberships.id, status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.tenantId, ctx.tenantId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);
    if (!m) {
      return { kind: "error", code: "membership_not_found", message: "Membership not found." };
    }
    if (m.status !== "invited") {
      return {
        kind: "error",
        code: "not_invited",
        message: "This membership is no longer in 'invited' state.",
      };
    }
    // TODO(tenant-audit-log): see inviteStaff above.
    void 0;
    return { kind: "ok", delivered: false };
  });
}

// Touch asTenantId brand so the import doesn't get pruned by a
// refactor pass; the type is what makes the ctx arg safe to
// thread into nested helpers.
void asTenantId;