// THE AUTHORITY BEHIND A CONFIRMATION — READ ONCE, USED TWICE.
//
// It is read by the WRITE side (lib/services/member-link-binding.ts,
// before a confirmation is written) and by the READ side
// (lib/services/self-service-session.ts, before an existing confirmation
// is relied on). One module, so the two cannot drift.
//
// THE AUTHORITY IS THE ACTOR'S OWN MEMBERSHIP ROW, NOT THE CONTEXT.
// `ActionCtx` carries a resolved permission set and a claimed facility
// scope, and neither is trusted here: a caller that claims a wider scope
// than it holds gets no wider authority.
//
// Membership, role, grant and facility reads remain tenant scoped. The global
// user is reached only through the tenant membership and must still be live.
//
// A REVOKED MEMBERSHIP GRANTS NO ACCESS — `status = 'active'` is
// load-bearing, the same rule lib/services/location-access.ts applies.

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  membershipLocations,
  tenantMemberships,
} from "@/db/schema/memberships";
import { rolePermissions, roles } from "@/db/schema/roles";
import { locations } from "@/db/schema/locations";
import { users } from "@/db/schema/users";
import { isFacilityScopedRoleKey } from "@/lib/services/facility-scope";
import { asUserId, type TenantId } from "@/lib/ids";

/**
 * The permission the 7 November 2026 decision creates.
 *
 * The catalogue row and the owner's backfill are a separate migration
 * (db/migrations/20261108210140_members_link_confirm_grant.sql). This
 * module READS the grant; it never writes it and never grants it.
 */
export const LINK_CONFIRM_PERMISSION = "members.link.confirm";

export type LinkAuthority = {
  /** The membership is live AND its role still carries the grant. */
  live: boolean;
  /** `all_locations = true` — club-wide. */
  unrestricted: boolean;
  /** The facilities the membership is CURRENTLY assigned to. */
  facilityIds: string[];
};

/**
 * Reads the LIVE authority of a set of accounts in one club.
 *
 * `tenant_memberships` is unique on `(tenant_id, user_id)`
 * (db/schema/memberships.ts:46), so an account holds AT MOST ONE
 * membership per club: one row per confirmer, and the Map is exact.
 *
 * FAIL CLOSED AT EVERY STEP: no live membership, no grant, no facility
 * assignment — each is a refusal, never a default-allow.
 */
export async function readLinkAuthorities(
  tx: TenantTx,
  args: { tenantId: TenantId; userIds: string[] },
): Promise<Map<string, LinkAuthority>> {
  const out = new Map<string, LinkAuthority>();
  if (args.userIds.length === 0) return out;

  const memberships = await tx
    .select({
      userId: tenantMemberships.userId,
      id: tenantMemberships.id,
      roleId: tenantMemberships.roleId,
      allLocations: tenantMemberships.allLocations,
      owner: roles.key,
    })
    .from(tenantMemberships)
    .innerJoin(roles, and(
      eq(roles.id, tenantMemberships.roleId),
      eq(roles.tenantId, tenantMemberships.tenantId),
      isNull(roles.deletedAt),
    ))
    .innerJoin(users, and(eq(users.id, tenantMemberships.userId), isNull(users.deletedAt)))
    .where(
      and(
        eq(tenantMemberships.tenantId, args.tenantId),
        inArray(tenantMemberships.userId, args.userIds.map(asUserId)),
        eq(tenantMemberships.status, "active"),
        isNull(tenantMemberships.deletedAt),
      ),
    ).for("share");

  if (memberships.length === 0) return out;

  const grants = await tx
    .select({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.tenantId, args.tenantId),
        inArray(
          rolePermissions.roleId,
          memberships.map((m) => m.roleId),
        ),
        eq(rolePermissions.permissionKey, LINK_CONFIRM_PERMISSION),
      ),
    ).for("share");
  const grantedRoles = new Set(grants.map((g) => g.roleId));

  const assignments = await tx
    .select({
      membershipId: membershipLocations.membershipId,
      locationId: membershipLocations.locationId,
    })
    .from(membershipLocations)
    .innerJoin(locations, and(
      eq(locations.id, membershipLocations.locationId),
      eq(locations.tenantId, membershipLocations.tenantId),
      isNull(locations.deletedAt),
    ))
    .where(
      and(
        eq(membershipLocations.tenantId, args.tenantId),
        inArray(
          membershipLocations.membershipId,
          memberships.map((m) => m.id),
        ),
      ),
    ).for("share");
  const byMembership = new Map<string, string[]>();
  for (const row of assignments) {
    const list = byMembership.get(row.membershipId) ?? [];
    list.push(row.locationId);
    byMembership.set(row.membershipId, list);
  }

  const allFacilityRows = memberships.some((m) => isFacilityScopedRoleKey(m.owner) && m.allLocations)
    ? await tx.select({ id: locations.id }).from(locations).where(and(
        eq(locations.tenantId, args.tenantId), isNull(locations.deletedAt),
      )).for("share")
    : [];
  const allFacilityIds = allFacilityRows.map((row) => row.id);
  for (const m of memberships) {
    out.set(m.userId, {
      live: grantedRoles.has(m.roleId),
      unrestricted: m.owner === "owner",
      facilityIds: isFacilityScopedRoleKey(m.owner) && m.allLocations
        ? allFacilityIds
        : byMembership.get(m.id) ?? [],
    });
  }
  return out;
}

/**
 * Does the attestation STILL CARRY AUTHORITY?
 *
 * FAIL CLOSED AT EVERY STEP:
 *   * no quartet            -> not an attestation;
 *   * no live membership    -> the confirmer is gone from the club;
 *   * the grant is not held -> the authority was withdrawn;
 *   * the scope no longer covers the facility -> the manager was
 *     re-assigned away from it.
 *
 * THE BASIS DECIDES WHICH BRANCH IS CHECKED, and the schema's CHECK makes
 * the two mutually exclusive: `owner_attestation` carries NO facility, and
 * the confirmer must still be club-wide; `facility_manager_attestation`
 * carries the facility, and the confirmer must still be assigned to it (or
 * have become club-wide).
 *
 * AN UNKNOWN BASIS IS NEVER AUTHORITY.
 */
export function attestationAuthorityStands(args: {
  quartetPresent: boolean;
  confirmerUserId: string | null;
  basis: string | null;
  facilityId: string | null;
  authority: LinkAuthority | undefined;
}): boolean {
  if (!args.quartetPresent) return false;
  if (args.confirmerUserId === null || args.basis === null) return false;

  const authority = args.authority;
  if (authority === undefined) return false; // no live membership
  if (!authority.live) return false; // the grant is gone

  if (args.basis === "owner_attestation") {
    // The owner's attestation carries NO facility: the confirmer must
    // still be club-wide.
    if (args.facilityId !== null) return false;
    return authority.unrestricted;
  }

  if (args.basis === "facility_manager_attestation") {
    // The manager's attestation carries the facility it was scoped to.
    if (args.facilityId === null) return false;
    if (authority.unrestricted) return true;
    return authority.facilityIds.includes(args.facilityId);
  }

  return false;
}
