import { v7 as uuidv7 } from "uuid";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatform } from "@/db/scope";
import { withTenant, type TenantTx } from "@/db/tenant";
import { callerIsLegacySystem } from "./resource-access";
import {
  findOrCreateUserByPhone,
  findPhonesByUserIds,
} from "@/db/user-account";
import { tenantMemberships, membershipLocations } from "@/db/schema/memberships";
import { roles } from "@/db/schema/roles";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { users } from "@/db/schema/users";
import type { StaffType } from "@/db/schema/staff";
import { staffLocations } from "@/db/schema/staff-locations";
import { ensurePersonAndStaff } from "@/db/invite-helpers";
import { writeAudit } from "@/lib/audit/write";
import { auth } from "@/lib/auth/server";
import type { ActionCtx } from "@/lib/auth/context";
import { asTenantId, type TenantId, type UserId } from "@/lib/ids";
import { enqueueInvitationNotification } from "@/lib/messaging/invitation-notification";
import { findBaUserIdByPhone } from "@/lib/services/credentials";
import { issueLoginLink } from "@/lib/services/invite-link-issue";

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
import { normaliseToE164 } from "@/lib/phone";

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
  // O-08 — worker and accountant close the attachment gap: before
  // this they could not be invited at all, so they could never carry
  // a location list (or a staff record).
  "worker",
  "accountant",
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
  const cleanedPhone = normaliseToE164(input.phone.replace(/[\s-]/g, ""));
  if (!E164_PLUS.test(cleanedPhone)) {
    return {
      kind: "error",
      code: "invalid",
      message: "Phone must be E.164 with country code (e.g. +919876543210).",
    };
  }

  // E-02 — the authenticated-actor guard runs BEFORE the first
  // write. (It used to sit after the membership insert, inside the
  // try: an unauthenticated call returned "invalid" while the
  // transaction still committed the membership and users row. The
  // audit requirement exposed that: a rejected invite must write
  // nothing at all, not merely skip its audit row.)
  if (!ctx.userId) {
    return {
      kind: "error",
      code: "invalid",
      message: "Invite requires an authenticated actor.",
    };
  }
  const actorId = ctx.userId;

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

    // InviteStaff audit gap fix: an invited coach was previously a
    // tenant_memberships row with NO persons row and NO staff row.
    // That left the operator with no way to assign the coach to a
    // batch (batches.coach_id → staff.id, which never existed), and
    // the audit gap meant the only fix was to walk the operator
    // through a "create staff record from scratch" path that
    // duplicated the person's identity. With this branch, the
    // invite path also produces the persons + staff rows the batch
    // assigner expects — same transaction, same identifiers.
    //
    // The actual SQL is in db/invite-helpers.ts:ensurePersonAndStaff,
    // which both invite paths call. STAFF_INVITABLE_ROLES maps
    // "admin" to "no staff row" deliberately: admins are operational,
    // they don't appear on the staff roster and aren't assigned to
    // batches. The helper skips the staff insert when staffType is
    // undefined.
    const STAFF_TYPE_FOR_ROLE: Partial<Record<StaffInvitableRoleKey, StaffType>> = {
      coach: "coach",
      receptionist: "receptionist",
      // O-08 — worker and accountant can hold a location too; before
      // this they got a membership but no staff record, so they could
      // never be attached to a site or paid per location.
      worker: "worker",
      accountant: "accountant",
    };
    const staffType = STAFF_TYPE_FOR_ROLE[input.roleKey];
    let invitedStaffId: string | null = null;
    try {
      const invited = await ensurePersonAndStaff(tx, ctx.tenantId, actorId, {
        fullName: input.fullName,
        userId: user.id as UserId,
        staffType,
      });
      invitedStaffId = invited.staffId;
      // O-08 — mirror the invite's explicit locations onto the staff
      // record (the access decision is still the membership's
      // location list; this is the staff↔location linkage the staff
      // record and per-location pay will read).
      if (invited.staffId && input.locationIds.length > 0) {
        for (const locationId of input.locationIds) {
          await tx
            .insert(staffLocations)
            .values({
              tenantId: ctx.tenantId,
              staffId: invited.staffId,
              locationId,
              isPrimary: false,
              createdBy: ctx.userId,
              updatedBy: ctx.userId,
            })
            .onConflictDoNothing();
        }
      }
    } catch {
      return {
        kind: "error",
        code: "invalid",
        message: "Could not create the person record for this invite.",
      };
    }

    await enqueueInvitationNotification(tx, ctx.tenantId, inserted[0].id);
    // E-02 — one row for the invite, written after every child write
    // succeeded and before the commit. The payload deliberately
    // carries identifiers (user, role, locations, staff) and never
    // the phone number or a link token.
    await writeAudit(tx, {
      tenantId: asTenantId(ctx.tenantId),
      actorType: "staff",
      actorId,
      action: "staff.invite",
      entityType: "tenant_membership",
      entityId: membershipId,
      after: {
        userId: user.id,
        roleKey: input.roleKey,
        locationIds: input.locationIds,
        status: "invited",
        staffId: invitedStaffId,
      },
      requestId: ctx.requestId ?? null,
    });

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

    // E-02 — same transaction as the status change; before carries
    // whatever state the row was in ('invited' or 'active') so the
    // trail survives the row's own overwrite.
    await writeAudit(tx, {
      tenantId: asTenantId(ctx.tenantId),
      actorType: "staff",
      actorId: ctx.userId ?? null,
      action: "staff.invitation.revoke",
      entityType: "tenant_membership",
      entityId: membershipId,
      before: { status: m.status },
      after: { status: "revoked", revokedAt: revokedAt.toISOString() },
      changedFields: ["status"],
      requestId: ctx.requestId ?? null,
    });

    return { kind: "ok", revokedAt };
  });
}

// A06 sibling (resend): the resend path signs no token directly, but
// enqueueInvitationNotification mints a bearer invite link into the
// outbox — hence the same issuer-target trust gate reset/relogin apply
// (invite-link-issue.ts's `trustGateDenies`): the issuer's tenant role
// rank (owner=0, admin=1, ...) must be at or above the target's actual
// active role rank. Refusal happens before the outbox enqueue and the
// audit write, so a denied resend materialises nothing.
//
// Legacy internal/system callers (no role key and no resolved
// permission set — the action layer is their authorization boundary)
// keep the pre-existing contract, matching issueLoginLink's "no issuer
// supplied" branch.
async function resendTrustGateDenies(
  tx: TenantTx,
  tenantId: TenantId,
  issuer: ActionCtx,
  targetOrdinal: number,
): Promise<boolean> {
  if (callerIsLegacySystem(issuer)) return false;
  let issuerOrdinal: number | null = null;
  if (issuer.roleKey) {
    const [row] = await tx
      .select({ homeOrdinal: roles.homeOrdinal })
      .from(roles)
      .where(
        and(
          eq(roles.tenantId, tenantId),
          eq(roles.key, issuer.roleKey),
          isNull(roles.deletedAt),
        ),
      )
      .limit(1);
    issuerOrdinal = row?.homeOrdinal ?? null;
  } else if (issuer.userId) {
    const [row] = await tx
      .select({ homeOrdinal: roles.homeOrdinal })
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
          eq(tenantMemberships.userId, issuer.userId),
          eq(tenantMemberships.status, "active"),
          isNull(tenantMemberships.deletedAt),
          isNull(roles.deletedAt),
        ),
      )
      .limit(1);
    issuerOrdinal = row?.homeOrdinal ?? null;
  }
  return issuerOrdinal === null || targetOrdinal < issuerOrdinal;
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
): Promise<
  | { kind: "ok"; delivered: false }
  | {
      kind: "error";
      code: "membership_not_found" | "not_invited" | "forbidden_target";
      message: string;
    }
> {
  const parsed = z.object({ membershipId: z.string().uuid() }).safeParse(rawInput);
  if (!parsed.success) {
    return { kind: "error", code: "membership_not_found", message: "Invalid membership id." };
  }
  const { membershipId } = parsed.data;
  return withTenant(ctx.tenantId, async (tx) => {
    const [m] = await tx
      .select({
        id: tenantMemberships.id,
        status: tenantMemberships.status,
        homeOrdinal: roles.homeOrdinal,
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
    if (await resendTrustGateDenies(tx, ctx.tenantId, ctx, m.homeOrdinal)) {
      return {
        kind: "error",
        code: "forbidden_target",
        message: "You cannot resend a credential for a higher-trust role.",
      };
    }
    await enqueueInvitationNotification(tx, ctx.tenantId, membershipId);
    await writeAudit(tx, {
      tenantId: asTenantId(ctx.tenantId),
      actorType: "staff",
      actorId: ctx.userId ?? null,
      action: "staff.invitation.resend",
      entityType: "tenant_membership",
      entityId: membershipId,
      after: { delivered: false },
      requestId: ctx.requestId ?? null,
    });
    return { kind: "ok", delivered: false };
  });
}

// R09 (2026-10-13 role-workflow audit) — deliberate reactivation of a
// revoked membership. The row is reused (identity, staff record,
// audit history and location list all preserved — no duplicate
// membership): status returns to 'invited' so the existing single-use
// invite-link flow issues and consumes the fresh credential.
//
// Safety properties:
//   - management only (staff.invite at the action layer) and the same
//     issuer-target ordinal trust gate as reset/relogin applies here;
//   - links_valid_from = now() kills every invite/relogin token minted
//     before the reactivation (see invite-link.ts preview/redeem);
//   - the target's better-auth sessions are deleted, so a session that
//     survived revocation cannot resume;
//   - a fresh single-use, tenant-bound invite link is issued through
//     the existing mechanism and the flip + audit share one
//     transaction.
export type ReactivateStaffResult =
  | {
      kind: "ok";
      urlPath: string;
      expiresAt: Date;
      roleKey: string;
      locationNames: string[];
      phone: string;
    }
  | {
      kind: "error";
      code:
        | "membership_not_found"
        | "not_revoked"
        | "forbidden_target"
        | "issue_failed";
      message: string;
    };

export async function reactivateInvitation(
  ctx: ActionCtx,
  rawInput: { membershipId: string },
): Promise<ReactivateStaffResult> {
  const parsed = z.object({ membershipId: z.string().uuid() }).safeParse(rawInput);
  if (!parsed.success) {
    return { kind: "error", code: "membership_not_found", message: "Invalid membership id." };
  }
  const { membershipId } = parsed.data;

  const prepared = await withTenant(ctx.tenantId, async (tx) => {
    const [m] = await tx
      .select({
        id: tenantMemberships.id,
        status: tenantMemberships.status,
        roleKey: roles.key,
        homeOrdinal: roles.homeOrdinal,
        userId: tenantMemberships.userId,
        phone: users.phone,
      })
      .from(tenantMemberships)
      .innerJoin(
        roles,
        and(
          eq(roles.id, tenantMemberships.roleId),
          eq(roles.tenantId, tenantMemberships.tenantId),
        ),
      )
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.tenantId, ctx.tenantId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);
    if (!m) {
      return { kind: "error" as const, code: "membership_not_found" as const, message: "Membership not found." };
    }
    if (m.status !== "revoked") {
      return { kind: "error" as const, code: "not_revoked" as const, message: "This membership is not revoked." };
    }
    if (await resendTrustGateDenies(tx, ctx.tenantId, ctx, m.homeOrdinal)) {
      return {
        kind: "error" as const,
        code: "forbidden_target" as const,
        message: "You cannot restore access for a higher-trust role.",
      };
    }

    const locationNames = (
      await tx
        .select({ name: locations.name })
        .from(membershipLocations)
        .innerJoin(locations, eq(locations.id, membershipLocations.locationId))
        .where(
          and(
            eq(membershipLocations.tenantId, ctx.tenantId),
            eq(membershipLocations.membershipId, membershipId),
          ),
        )
    ).map((l) => l.name);

    await tx
      .update(tenantMemberships)
      .set({
        status: "invited",
        linksValidFrom: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.status, "revoked"),
        ),
      );

    await writeAudit(tx, {
      tenantId: asTenantId(ctx.tenantId),
      actorType: "staff",
      actorId: ctx.userId ?? null,
      action: "membership.reactivate",
      entityType: "tenant_membership",
      entityId: membershipId,
      before: { status: "revoked" },
      after: { status: "invited", roleKey: m.roleKey },
      changedFields: ["status", "links_valid_from"],
      requestId: ctx.requestId ?? null,
    });

    return {
      kind: "ok" as const,
      userId: m.userId,
      phone: m.phone,
      locationNames,
    };
  });
  if (prepared.kind === "error") return prepared;

  // Old sessions must not resume: revocation already blocked them, but
  // the identity is live again now, so delete them outright. Failure to
  // reach better-auth must not silently leave stale sessions usable —
  // surface it and stop before issuing the fresh link.
  try {
    const baUserId = await findBaUserIdByPhone(prepared.phone);
    if (baUserId) {
      const baCtx = await auth.$context;
      await baCtx.internalAdapter.deleteUserSessions(baUserId);
    }
  } catch {
    return {
      kind: "error",
      code: "issue_failed",
      message: "Could not invalidate the old sessions. Try again.",
    };
  }

  const link = await issueLoginLink(ctx.tenantId, membershipId, ctx);
  if (link.kind === "error") {
    return { kind: "error", code: "issue_failed", message: link.message };
  }
  return {
    kind: "ok",
    urlPath: link.urlPath,
    expiresAt: link.expiresAt,
    roleKey: link.roleKey,
    locationNames: prepared.locationNames,
    phone: link.phone,
  };
}

// Touch asTenantId brand so the import doesn't get pruned by a
// refactor pass; the type is what makes the ctx arg safe to
// thread into nested helpers.
void asTenantId;
