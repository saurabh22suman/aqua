// The facility manager's APPOINTMENT rules — server side.
//
// A manager is the owner's delegate for selected facilities or the whole tenant, so appointing one
// is an owner act. This module holds the two rules that make the
// appointment safe, and nothing else:
//
//   1. ONLY A LIVE OWNER MAY APPOINT A MANAGER.
//   2. SCOPE IS EXPLICITLY TENANT-WIDE OR ONE OR MORE LIVE TENANT FACILITIES.
//
// Both rules are checked BEFORE the global account lookup, so a refused
// appointment creates no user row and no orphan account; and both are
// checked AGAIN inside the transaction that writes the membership, the
// selected facilities and the audit row, so a revocation or a role change
// that lands in between cannot slip a manager through.
//
// ── WHY THE OWNER CHECK IS A ROLE ROW AND NOT A GRANT ──────────────────
//
// The product already answers "who is this club's owner?" from the ROLE
// ROW in five owner-identity places (lib/services/staff-invitations.ts's
// sole-owner guard, lib/services/owner-reset.ts, the two credential
// paths in lib/services/invite-link-issue.ts and lib/services/invite-link.ts,
// and db/tenant-invite.ts). This module asks the same question through
// the same predicate the leave catalogue already uses.
//
// THE EXCEPTION THIS USE DEPENDS ON — READ IT BEFORE APPROVING.
//
// `callerIsLiveOwnerInTx` (lib/services/leave-owner-identity.ts) resolves
// authorisation from the literal `roles.key = 'owner'`. That is the
// bounded F-04 / F-03a exception ("never hard-code behaviour to a role
// name"), and its approved scope is ONE surface: the leave-TYPE catalogue
// write (docs/design/parallel-release/manager-owner-types-existing-
// identity-final-review-20261108/OWNER-IDENTITY-EXCEPTION.md §2.1: "One
// surface. Only the leave-TYPE catalogue write. No other behaviour
// changes.").
//
// THE MANAGER APPOINTMENT IS A SECOND SURFACE. It is NOT covered by that
// approval and needs its own, exact, written approval before this module
// ships. What such an approval must say, at minimum:
//
//   • the surface: the manager APPOINTMENT only — creating a tenant
//     membership whose role is the manager role;
//   • the literal: "owner", in the ONE constant that already exists
//     (OWNER_ROLE_KEY), read from the caller's own live membership and
//     that membership's live role row — never from ctx.roleKey,
//     ctx.roleId, ctx.membershipId or ctx.permissions;
//   • the live read: inside the caller's own withTenant() transaction,
//     tenant-named, under the forced RLS on tenant_memberships and roles;
//   • fail-closed: one refusal for every non-answer;
//   • no new artefact: no catalogue key, no schema change, no migration.
//
// The alternative — a new capability key on the grant table — was already
// reviewed to a NO-GO (a unique index proves at most one holder, not that
// the holder is the owner). See the exception document.
//
// ── WHY THE FACILITIES ARE CHECKED TWICE ───────────────────────────────
//
// The preflight runs in its OWN tenant transaction, before the global
// account lookup, so a bad request never reaches the platform scope. The
// authoritative check runs in the SAME transaction as the membership,
// the membership_locations rows and the audit row, so the scope a manager
// is actually appointed with is the scope that was validated.
//
// The two scopes are SEQUENTIAL, never nested (db/scope.ts:56-72 throws
// when a tenant scope is entered inside another tenant or user scope).

import { and, eq, inArray, isNull } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { locations } from "@/db/schema/locations";
import type { ActionCtx } from "@/lib/auth/context";
import type { TenantId } from "@/lib/ids";
import { callerIsLiveOwnerInTx } from "@/lib/services/leave-owner-identity";
import { MANAGER_ROLE_KEY } from "@/lib/services/manager-role-grants";

/**
 * The refusals this module can produce. They are RESULT codes, never
 * throws: a refusal that threw would roll the transaction back and
 * surface as an unhandled error at the action layer.
 */
export type ManagerAppointmentRefusalCode =
  /** The caller is not a live owner of this academy. */
  | "owner_required"
  /** No facility or explicit tenant-wide scope was chosen. */
  | "facilities_required"
  /** A tenant-wide choice and a facility list cannot be combined. */
  | "conflicting_scope"
  /** The same facility was chosen twice. */
  | "duplicate_facilities"
  /** A chosen facility is not a live facility of this academy. */
  | "facility_not_found";

export type ManagerAppointmentRefusal = {
  ok: false;
  code: ManagerAppointmentRefusalCode;
  message: string;
};

export type ManagerAppointmentSelection = {
  ok: true;
  /** The distinct facility ids, in the order they were chosen. */
  locationIds: string[];
  allLocations: boolean;
};

/** Is this the manager role key? One place, so no call site guesses. */
export function isManagerRoleKey(roleKey: string): boolean {
  return roleKey === MANAGER_ROLE_KEY;
}

/** Validate the explicit scope; named facilities must be distinct and live in this tenant. */
export async function validateManagerFacilitySelection(
  tx: TenantTx,
  tenantId: TenantId,
  locationIds: readonly string[],
  allLocations = false,
): Promise<ManagerAppointmentSelection | ManagerAppointmentRefusal> {
  if (allLocations) {
    if (locationIds.length > 0) return { ok: false, code: "conflicting_scope", message: "Choose the whole academy or selected facilities, not both." };
    return { ok: true, locationIds: [], allLocations: true };
  }
  const distinct = [...new Set(locationIds)];
  if (distinct.length === 0) {
    return {
      ok: false,
      code: "facilities_required",
      message: "Choose at least one facility for the manager.",
    };
  }
  if (distinct.length !== locationIds.length) {
    return {
      ok: false,
      code: "duplicate_facilities",
      message: "The same facility was chosen twice.",
    };
  }
  const live = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        inArray(locations.id, distinct),
        isNull(locations.deletedAt),
      ),
    );
  if (live.length !== distinct.length) {
    return {
      ok: false,
      code: "facility_not_found",
      message: "One of the chosen facilities doesn't belong to this academy.",
    };
  }
  return { ok: true, locationIds: distinct, allLocations: false };
}

/**
 * The owner check, inside a caller's own tenant transaction.
 *
 * A thin, named wrapper over the leave catalogue's predicate, so the one
 * place the role-name literal lives stays the one place. See the module
 * header for the exception this use needs.
 */
export async function callerIsLiveOwnerForManagerAppointment(
  tx: TenantTx,
  ctx: ActionCtx,
): Promise<boolean> {
  return callerIsLiveOwnerInTx(tx, ctx);
}

/**
 * THE PREFLIGHT — everything that must hold BEFORE the global account
 * lookup, so a refused appointment creates no user row.
 *
 * It opens its own tenant scope, and that scope CLOSES before the caller
 * opens the platform scope for the account lookup. The scopes are
 * sequential, never nested.
 *
 * The owner answer here is a FAST filter, not the authoritative one: the
 * service re-reads the membership inside the transaction that writes the
 * membership, and that answer is the one that decides.
 */
export async function preflightManagerAppointment(
  ctx: ActionCtx,
  locationIds: readonly string[],
  allLocations = false,
): Promise<ManagerAppointmentSelection | ManagerAppointmentRefusal> {
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await callerIsLiveOwnerForManagerAppointment(tx, ctx))) {
      return {
        ok: false,
        code: "owner_required",
        message: "Only the academy owner can appoint a facility manager.",
      };
    }
    return validateManagerFacilitySelection(tx, ctx.tenantId, locationIds, allLocations);
  });
}
