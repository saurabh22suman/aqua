import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "./tenant";
import { withPlatform } from "./scope";
import { db } from "./client";
import { users } from "./schema/users";
import { tenantMemberships } from "./schema/memberships";
import { roles } from "./schema/roles";
import { tenants } from "./schema/tenants";
import { platformAuditLog } from "./schema/platform-users";
import { ensurePersonAndStaff } from "./invite-helpers";
import type { StaffType } from "./schema/staff";
import type { TenantId, UserId } from "@/lib/ids";

// Phase 2.7 — "invite the owner, assign role" — the third step of
// the onboarding wizard. After the operator creates a tenant
// (1.5) and applies a preset (2.6), the operator invites a real
// person to be the tenant's owner. The action:
//
//   1. finds-or-creates the `users` row keyed by phone
//   2. inserts a `tenant_memberships` row tied to the tenant's
//      `owner` role (created by seedRoleTemplates at tenant
//      creation; the 2.7 layer assumes that ran)
//   3. writes a `platform_audit_log` row carrying the membership
//      creation event
//
// Status is `invited` per the tenant_memberships_status_check
// constraint. The invited user accepts later by completing a
// phone-OTP login (architecture §6.1, F-9): better-auth's
// callbackOnVerification (lib/auth/server.ts) fires the moment that
// OTP verifies, and calls activateInvitedMemberships (D1,
// db/membership-activation.ts) right there — invited -> active
// happens synchronously in that hook, not on some later "first
// authenticated request" (no such step exists in this codebase).
//
// Two transactions: the user find-or-create runs in `withPlatform`
// (the `users` table is in the platform allowlist, RLS-exempt);
// the membership insert runs in `withTenant` (tenant-scoped).
// Splitting them means the user can be created (or matched)
// without holding the tenant transaction open — the membership
// insert is the only step that needs the tenant scope.

export type InviteOwnerResult =
  | {
      kind: "ok";
      userId: string;
      membershipId: string;
      personId: string;
      staffId: string | null;
      wasNewUser: boolean;
    }
  | {
      kind: "error";
      code:
        | "invalid"
        | "tenant_not_found"
        | "owner_role_missing"
        | "already_member";
      message: string;
    };

import { normaliseToE164 } from "@/lib/phone";

const E164_PLUS = /^\+\d{8,15}$/;

// PR C — when no fullName is given, derive a placeholder from the
// phone so the always-required persons.full_name column still has a
// value. The PR C form (lib/actions/platform-invite-owner.ts) passes
// the operator-entered name explicitly; this fallback is for the
// platform-side backfill path (tests/tier1/membership-activation.test.ts
// and tenant-creation-parity.test.ts seed memberships without a
// name) and keeps the helper the only place a persons row is created.
function defaultFullName(phone: string): string {
  const last4 = phone.replace(/\D/g, "").slice(-4);
  return `Owner +••• ${last4}`;
}

export async function inviteOwner(
  tenantId: TenantId,
  input: {
    phone: string;
    fullName?: string;
    staffType?: StaffType;
    actorId: UserId;
  },
): Promise<InviteOwnerResult> {
  // Strip whitespace/dashes, then route through the canonical
  // helper so an operator who paste-enters `919876543210`
  // (without the +91) still hits the same canonical row that
  // the seed/lookup paths use.
  const cleaned = normaliseToE164(input.phone.replace(/[\s-]/g, ""));
  if (!E164_PLUS.test(cleaned)) {
    return {
      kind: "error",
      code: "invalid",
      message: "Phone must be E.164 with country code (e.g. +919876543210).",
    };
  }
  const fullName = (input.fullName ?? "").trim() || defaultFullName(cleaned);

  // 1. find-or-create the user. `users` is in the platform
  // allowlist; withPlatform() is the standing scope for any
  // platform-side read/write. Phone is unique — on conflict we
  // reuse the existing user (their phone is their identity).
  const user = await withPlatform(async () => {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, cleaned))
      .limit(1);
    if (existing[0]) {
      return { id: existing[0].id, wasNew: false };
    }
    const inserted = await db
      .insert(users)
      .values({
        phone: cleaned,
      })
      .returning({ id: users.id });
    return { id: inserted[0]!.id, wasNew: true };
  });

  // 2. find the tenant's owner role (created by seedRoleTemplates).
  // 3. insert the membership in withTenant. Unique key on
  // (tenant_id, user_id) means a re-invite would 23505; the action
  // reports that as "already_member" rather than crashing.
  return withTenant(tenantId, async (tx) => {
    const tenantExists = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (tenantExists.length === 0) {
      return {
        kind: "error",
        code: "tenant_not_found",
        message: "No tenant with that id.",
      };
    }

    const ownerRole = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, "owner")))
      .limit(1);
    if (ownerRole.length === 0) {
      return {
        kind: "error",
        code: "owner_role_missing",
        message:
          "This tenant has no 'owner' role. seedRoleTemplates should have run at tenant creation — that's a data fixture issue.",
      };
    }

    const existingMembership = await tx
      .select({ id: tenantMemberships.id })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, user.id as never),
        ),
      )
      .limit(1);
    if (existingMembership[0]) {
      return {
        kind: "error",
        code: "already_member",
        message: "This user is already a member of the tenant.",
      };
    }

    const inserted = await tx
      .insert(tenantMemberships)
      .values({
        id: uuidv7(),
        tenantId,
        userId: user.id as never,
        roleId: ownerRole[0]!.id,
        status: "invited",
        allLocations: true,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })
      .returning({ id: tenantMemberships.id });
    const membershipId = inserted[0]!.id;

    // PR C — persons + (optional) staff row from the same shared
    // helper inviteStaff uses. Without this branch an owner who
    // also coaches has no persons/staff row and therefore cannot
    // be assigned to a batch (batches.coach_id → staff.id, which
    // never existed). staffType is optional; the owner who doesn't
    // coach gets only the persons row.
    const personStaff = await ensurePersonAndStaff(tx, tenantId, input.actorId, {
      fullName,
      userId: user.id as never,
      staffType: input.staffType,
    });

    await tx.insert(platformAuditLog).values({
      actorId: input.actorId,
      tenantId,
      action: "tenant.invite_owner",
      targetType: "tenant_membership",
      targetId: membershipId,
      detail: {
        phone: cleaned,
        userId: user.id,
        wasNewUser: user.wasNew,
      },
    });

    return {
      kind: "ok",
      userId: user.id,
      membershipId,
      personId: personStaff.personId,
      staffId: personStaff.staffId,
      wasNewUser: user.wasNew,
    };
  });
}
void sql;
