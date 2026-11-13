import { callerIsLiveOwnerForSettingsOrDelegation } from "@/lib/services/owner-authority";
import { v7 as uuidv7 } from "uuid";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
import { baUser, baSession } from "@/db/schema/better-auth";
import { staff, type StaffType } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { staffLocations } from "@/db/schema/staff-locations";
import { ensurePersonAndStaff } from "@/db/invite-helpers";
import { writeAudit } from "@/lib/audit/write";
import type { ActionCtx } from "@/lib/auth/context";
import { asTenantId, type TenantId, type UserId } from "@/lib/ids";
import { enqueueInvitationNotification } from "@/lib/messaging/invitation-notification";
import { issueLoginLink } from "@/lib/services/invite-link-issue";
import {
  callerIsLiveOwnerForManagerAppointment,
  preflightManagerAppointment,
  validateManagerFacilitySelection,
} from "@/lib/services/manager-appointment";
import { MANAGER_ROLE_KEY } from "@/lib/services/manager-role-grants";

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
//
// Manager scope is explicit and validated at appointment.
export const STAFF_INVITABLE_ROLES = [
  "admin",
  "coach",
  "receptionist",
  // O-08 — worker and accountant close the attachment gap: before
  // this they could not be invited at all, so they could never carry
  // a location list (or a staff record).
  "worker",
  "accountant",
  // Manager has operational authority within the owner-selected scope.
  MANAGER_ROLE_KEY,
] as const;

export type StaffInvitableRoleKey = (typeof STAFF_INVITABLE_ROLES)[number];

export type InviteStaffInput = {
  phone: string;
  fullName: string;
  roleKey: StaffInvitableRoleKey;
  // Other roles retain empty = all. Manager requires an explicit all choice.
  managerAllLocations?: boolean;
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
        | "would_leave_zero_owners"
        // The manager appointment's refusals. Every one of them is
        // raised BEFORE any row is written.
        | "owner_required"
        | "facilities_required"
        | "conflicting_scope"
        | "duplicate_facilities"
        | "facility_not_found"
        | "uncertain";
      message: string;
    };

const inputSchema = z.object({
  phone: z.string().trim().min(1).max(40),
  fullName: z.string().trim().min(1).max(200),
  roleKey: z.enum(STAFF_INVITABLE_ROLES),
  locationIds: z.array(z.string().uuid()).max(50).default([]),
  managerAllLocations: z.boolean().default(false),
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

  try {
  // Early refusal avoids a global identity lookup for an already-denied actor.
  // Authority is checked again in the membership write transaction.
  if (!(await withTenant(ctx.tenantId, (tx) => callerIsLiveOwnerForSettingsOrDelegation(tx, ctx)))) {
    return { kind: "error", code: "owner_required", message: "Only the academy owner can manage invitations." };
  }

  // ── THE MANAGER APPOINTMENT PREFLIGHT ──────────────────────────────
  //
  // Manager appointment is an OWNER act; scope is explicit. Both are checked HERE,
  // BEFORE the global account lookup below, so a refused manager
  // appointment creates no user row and no orphan account.
  //
  // This preflight opens its OWN tenant scope, and that scope closes
  // before the platform scope opens: the scopes are SEQUENTIAL, never
  // nested (db/scope.ts:56-72). The answer here is a fast filter —
  // the authoritative owner check runs again inside the transaction
  // that writes the membership.
  let locationIds = input.locationIds;
  if (input.roleKey === MANAGER_ROLE_KEY) {
    const preflight = await preflightManagerAppointment(ctx, locationIds, input.managerAllLocations);
    if (!preflight.ok) {
      return {
        kind: "error",
        code: preflight.code,
        message: preflight.message,
      };
    }
    locationIds = preflight.locationIds;
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
  return await withTenant(ctx.tenantId, async (tx) => {
    if (!(await callerIsLiveOwnerForSettingsOrDelegation(tx, ctx))) {
      return { kind: "error", code: "owner_required", message: "Only the academy owner can manage invitations." };
    }
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

    // ── THE MANAGER'S OWN GATE, INSIDE THE WRITE TRANSACTION ────────
    //
    // The preflight above ran in its own transaction, before the
    // global account lookup. THIS is the authoritative check: it runs
    // in the SAME transaction that inserts the membership, the
    // selected facilities and the audit row, so a revocation or a
    // role change that lands in between cannot slip a manager
    // through, and a refusal writes NOTHING at all.
    //
    // It reads the caller's own live membership and that membership's
    // live role row — never ctx.roleKey, ctx.roleId or
    // ctx.permissions — through the one predicate the leave
    // catalogue already uses. See lib/services/manager-appointment.ts
    // for the F-04/F-03a exception this second surface needs.
    if (input.roleKey === MANAGER_ROLE_KEY) {
      if (!(await callerIsLiveOwnerForManagerAppointment(tx, ctx))) {
        return {
          kind: "error",
          code: "owner_required",
          message: "Only the academy owner can appoint a facility manager.",
        };
      }
      const selection = await validateManagerFacilitySelection(
        tx,
        ctx.tenantId,
        locationIds,
        input.managerAllLocations,
      );
      if (!selection.ok) {
        return {
          kind: "error",
          code: selection.code,
          message: selection.message,
        };
      }
      locationIds = selection.locationIds;
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
    if (locationIds.length > 0) {
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
      for (const lid of locationIds) {
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
        allLocations: input.roleKey === MANAGER_ROLE_KEY
          ? input.managerAllLocations
          : locationIds.length === 0,
        status: "invited",
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: tenantMemberships.id });
    const membershipId = inserted[0]!.id;

    // Per-location scope rows when locationIds were given.
    if (locationIds.length > 0) {
      for (const lid of locationIds) {
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
    //
    // 2026-11-09 manager rollout — the MANAGER is also "no staff
    // row", for the same reason as the administrator: staff.staff_type
    // carries a check constraint over ('coach', 'receptionist',
    // 'worker', 'accountant') (db/schema/staff.ts), and adding a
    // 'manager' value is a schema change this rollout does not make.
    // The manager is appointed with a membership and a person row, and
    // its facilities come from membership_locations — not from a staff
    // row. Consequence, recorded as a follow-on: a manager cannot be
    // rostered on the staff roster or assigned to a batch.
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
      if (invited.staffId && locationIds.length > 0) {
        for (const locationId of locationIds) {
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
      // A failure after membership insertion must abort the transaction.
      throw new Error("Invitation setup failed");
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
        locationIds,
        allLocations: input.roleKey === MANAGER_ROLE_KEY ? input.managerAllLocations : locationIds.length === 0,
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
  } catch {
    return { kind: "error", code: "uncertain", message: "Could not confirm the invitation. Refresh and check the invitations list before trying again." };
  }
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

    // Names belong to the tenant's person records, not the global user.
    // A user may have a different name at another club or multiple staff roles.
    const namesByUserAndRole = new Map<string, string>();
    if (userIds.length > 0) {
      const staffNames = await tx
        .select({ userId: staff.userId, roleKey: staff.staffType, fullName: persons.fullName })
        .from(staff)
        .innerJoin(persons, and(
          eq(persons.id, staff.personId),
          eq(persons.tenantId, staff.tenantId),
          isNull(persons.deletedAt),
        ))
        .where(and(
          eq(staff.tenantId, ctx.tenantId),
          inArray(staff.userId, userIds),
          isNull(staff.deletedAt),
        ))
        .orderBy(staff.id);
      for (const row of staffNames) {
        if (row.userId) {
          const key = `${row.userId}:${row.roleKey}`;
          if (!namesByUserAndRole.has(key)) namesByUserAndRole.set(key, row.fullName);
        }
      }
    }

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
      fullName: namesByUserAndRole.get(`${m.userId}:${m.roleKey}`) ?? "",
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
// Only a PostgreSQL deadlock abort is safe to retry after transaction rollback.
function isOwnerDelegationDeadlock(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === "40P01") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export type RevokeStaffResult =
  | { kind: "ok"; revokedAt: Date }
  | {
      kind: "error";
      code:
        | "membership_not_found"
        | "already_revoked"
        | "would_leave_zero_owners"
        | "not_invited_or_active"
        | "owner_required"
        | "uncertain";
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

  const execute = (): Promise<RevokeStaffResult> => withTenant(ctx.tenantId, async (tx) => {
    if (!(await callerIsLiveOwnerForSettingsOrDelegation(tx, ctx))) {
      return { kind: "error", code: "owner_required", message: "Only the academy owner can manage invitations." };
    }
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
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await execute();
    } catch (error) {
      // PostgreSQL has aborted a deadlock victim; withTenant returns only
      // after its rollback. Retry the entire authority and sole-owner checks.
      if (isOwnerDelegationDeadlock(error) && attempt < 2) continue;
      // Commit/connection errors may have an uncertain outcome. Do not leak
      // Drizzle SQL parameters or imply that a blind retry is always safe.
      return { kind: "error", code: "uncertain", message: "Could not confirm the outcome. Refresh before trying again." };
    }
  }
  return { kind: "error", code: "uncertain", message: "Could not confirm the outcome. Refresh before trying again." };
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
// Done When mentions "resend" knowing it is a no-op until the
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
      code:
        | "membership_not_found"
        | "not_invited"
        | "forbidden_target"
        | "uncertain";
      message: string;
    }
> {
  const parsed = z.object({ membershipId: z.string().uuid() }).safeParse(rawInput);
  if (!parsed.success) {
    return { kind: "error", code: "membership_not_found", message: "Invalid membership id." };
  }
  const { membershipId } = parsed.data;
  try {
  return await withTenant(ctx.tenantId, async (tx) => {
    if (!(await callerIsLiveOwnerForSettingsOrDelegation(tx, ctx))) {
      return { kind: "error", code: "forbidden_target", message: "Only the academy owner can manage invitations." };
    }
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
  } catch {
    return { kind: "error", code: "uncertain", message: "Could not confirm the invitation reminder. Refresh and check before trying again." };
  }
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
        | "issue_failed"
        | "identity_unlinked"
        | "uncertain";
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
    if (!(await callerIsLiveOwnerForSettingsOrDelegation(tx, ctx))) {
      return { kind: "error" as const, code: "forbidden_target" as const, message: "Only the academy owner can manage invitations." };
    }
    const [m] = await tx
      .select({
        id: tenantMemberships.id,
        status: tenantMemberships.status,
        roleKey: roles.key,
        homeOrdinal: roles.homeOrdinal,
        userId: tenantMemberships.userId,
        phone: users.phone,
        betterAuthId: users.betterAuthId,
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
      .limit(1).for("update", { of: [tenantMemberships, users] });
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

    // Revoke the actual linked global Better Auth principal in this same
    // transaction; only fall back to phone when the user is unlinked.
    const baUserId = m.betterAuthId;
    if (baUserId !== null) {
      if (!baUserId) throw new Error("Invalid linked identity");
      const [linked] = await tx.select({ id: baUser.id }).from(baUser)
        .where(eq(baUser.id, baUserId)).limit(1);
      if (!linked) throw new Error("Invalid linked identity");
    } else {
      const [byPhone] = await tx.select({ id: baUser.id }).from(baUser)
        .where(eq(baUser.phoneNumber, m.phone)).limit(1);
      if (byPhone) {
        // A phone match alone cannot prove this is the target's identity.
        return { kind: "error" as const, code: "identity_unlinked" as const,
          message: "This account's sign-in identity needs review before access can be restored." };
      }
    }
    if (baUserId !== null) await tx.delete(baSession).where(eq(baSession.userId, baUserId));

    const changed = await tx
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
      ).returning({ id: tenantMemberships.id });
    if (changed.length !== 1) throw new Error("Reactivation state changed");

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
  }).catch(() => ({ kind: "error" as const, code: "uncertain" as const,
    message: "Could not confirm reactivation. Refresh and check the invitation status before trying again." }));
  if (prepared.kind === "error") return prepared;

  // Reactivation and session deletion committed together. A later link
  // issuance failure leaves a pending invitation that an owner can revisit.
  let link: Awaited<ReturnType<typeof issueLoginLink>>;
  try {
    link = await issueLoginLink(ctx.tenantId, membershipId, ctx);
  } catch {
    return { kind: "error", code: "issue_failed", message: "Access is pending. Refresh, then ask an owner to generate and share a sign-in link." };
  }
  if (link.kind === "error") {
    return { kind: "error", code: "issue_failed", message: "Access is pending. Refresh, then ask an owner to generate and share a sign-in link." };
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
