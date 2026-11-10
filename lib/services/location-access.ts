import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { TenantTx } from "@/db/tenant";
import { resolveConfigInTx } from "@/db/config";
import { membershipLocations, tenantMemberships } from "@/db/schema/memberships";
import { locations } from "@/db/schema/locations";
import { roles } from "@/db/schema/roles";
import type { ActionCtx } from "@/lib/auth/context";
import { isFacilityScopedRoleKey } from "./facility-scope";

// O-08 (docs/ops-platform-design.md §8) — location-scoped staff access.
//
// This is an ACCESS-CONTROL boundary inside one tenant, never an
// isolation boundary. One business, one controller, one RLS scope: a
// leak across locations is an internal permissions bug; a leak across
// tenants is a breach. Every doc, test name and error here keeps that
// distinction.
//
// The key `access.location_scoped_staff` defaults OFF — today's
// tenant-wide behaviour. When ON, a staff member whose membership
// carries an explicit location list (membership_locations) is
// constrained to those locations on the enforced service reads and
// writes. An all-locations manager retains a scoped manager identity. A job
// must identify itself explicitly; an omitted human identity is not a job.
//
// ── THE THREE ANSWERS, AND WHY AN EMPTY LIST IS NOT A DENIAL ─────────
//
// `LocationAccess` has exactly three meaningful answers:
//
//   • unrestricted                   — every row, including NULL-location
//                                      (whole-business) rows;
//   • denied                         — NO row at all, including NULL-location
//                                      rows. This is the fail-closed answer;
//   • scoped                         — the named facilities, plus NULL-location
//                                      rows only when includeUnlocated is true.
//
// An empty `locationIds` is NOT a denial. For a legacy O-08 staff
// membership with no facilities and the switch ON it means "no located
// rows, but the tenant-wide NULL rows still belong to the whole
// business" (the house rule the owner-insights and attendance-report
// contracts describe). For a facility-scoped role it means "no rows" —
// the role's named facilities are its entire scope. The explicit
// `denied` flag is the only complete denial.
//
// ── NULL-LOCATION ROWS ────────────────────────────────────────────────
//
// A row whose location is NULL is tenant-wide by design (a batch, session,
// attendance row or unresolved enquiry that belongs to the whole business).
// Such a row is:
//
//   • visible to an unrestricted caller (system actor, owner/all-locations);
//   • visible to a legacy O-08 scoped caller (includeUnlocated = true), so
//     the established house rule does not move for reception, coach, etc.;
//   • NOT visible to a denied caller;
//   • visible to a tenant-wide manager; hidden from a manager limited to named facilities.
//
// ── THE FACILITY-SCOPED ROLE ──────────────────────────────────────────
//
// A role in FACILITY_SCOPED_ROLE_KEYS (lib/services/facility-scope.ts) is
// bound to the facilities its OWN ACTIVE membership names, unconditionally:
// the tenant-wide switch neither widens nor narrows it. The switch keeps
// its exact meaning for every other role.
//
// ── FAIL-CLOSED MEMBERSHIP RULES ──────────────────────────────────────
//
// When the context carries a user identity, the membership row is the
// authority:
//
//   • a REVOKED or DELETED membership grants nothing, before the switch;
//   • a MISSING membership grants nothing, before the switch, whatever the
//     context claims;
//   • the membership's role decides the branch; ctx.roleKey never overrides
//     an existing membership row.
//
// The missing-membership answer is the strict "Option A" recorded in the
// packet README §7. It conflicts with protected tier1 fixtures that build
// a user id without a membership row and expect the old answer; those
// fixtures must be updated by their owner (or `systemActor: true` used for
// genuine internal callers) before this packet is approval-ready.

export const LOCATION_SCOPED_STAFF_KEY = "access.location_scoped_staff" as const;

export type LocationAccess =
  | { unrestricted: true }
  | {
      unrestricted: false;
      /**
       * True only when NO row is reachable, including NULL-location rows.
       * Never inferred from an empty locationIds.
       */
      denied: boolean;
      /** The caller's own selected facilities. Empty is a valid empty scope. */
      locationIds: string[];
      /**
       * True only when rows whose location_id IS NULL (the whole business)
       * are visible. False for a denied caller and for a facility-scoped
       * role; true for the legacy O-08 scoped staff path.
       */
      includeUnlocated: boolean;
    };

// The full Ctx carries allLocations/locationIds; the narrowed ActionCtx
// does not. Accept the widened shape and fall back to a database
// lookup when the fields are absent (internal callers, tests).
//
// The narrowed shape is not hypothetical: three action adapters build
// `{ tenantId, userId }` on purpose (lib/actions/people.ts:124 and
// :181, lib/actions/coach.ts:293), so the helper must be able to
// answer from the caller's MEMBERSHIP alone. `roleKey` is optional in
// ActionCtx for the same reason, and a scope decision that reads the
// role from the ctx alone therefore misses exactly the callers it is
// meant to constrain.
export type LocationAwareCtx = ActionCtx & {
  allLocations?: boolean;
  locationIds?: string[];
  systemActor?: true;
};

function unrestrictedAccess(): LocationAccess {
  return { unrestricted: true };
}

function deniedAccess(): LocationAccess {
  return {
    unrestricted: false,
    denied: true,
    locationIds: [],
    includeUnlocated: false,
  };
}

function scopedAccess(
  locationIds: string[],
  includeUnlocated: boolean,
): LocationAccess {
  return {
    unrestricted: false,
    denied: false,
    locationIds,
    includeUnlocated,
  };
}

async function locationScopedStaffEnabled(
  tx: TenantTx,
  tenantId: LocationAwareCtx["tenantId"],
): Promise<boolean> {
  const { value } = await resolveConfigInTx<boolean>(
    tx,
    tenantId,
    LOCATION_SCOPED_STAFF_KEY,
  );
  return value === true;
}

export async function resolveLocationAccess(
  tx: TenantTx,
  ctx: LocationAwareCtx,
): Promise<LocationAccess> {
  // A job must identify itself explicitly. An identity-free system
  // actor is not a person, so there is no membership to resolve and
  // no facility scope to apply.
  if (ctx.systemActor === true && !ctx.userId) return unrestrictedAccess();

  // Identity-free non-system caller: the legacy internal path. There is
  // no human identity, hence no membership that can be missing. Preserve
  // the switch's exact answer for these callers (the protected tier1
  // suites call services this way with `{ tenantId }`).
  if (!ctx.userId) {
    return (await locationScopedStaffEnabled(tx, ctx.tenantId))
      ? deniedAccess()
      : unrestrictedAccess();
  }

  // ── A USER IDENTITY EXISTS: THE MEMBERSHIP IS THE AUTHORITY ────────
  //
  // Read the caller's own membership in this tenant, whatever its status.
  // The ctx's role claim is never trusted over it: a caller whose
  // membership is the facility-scoped manager must stay scoped even if
  // the ctx names the owner, and a caller whose membership was revoked
  // must stay denied even if the ctx claims another role.
  const membership = await resolveCallerMembership(tx, ctx);

  if (!membership) {
    // No membership row: no authority, whatever the context claims. The
    // strict answer is deliberately taken BEFORE the switch, so "switch
    // off" cannot turn a non-member into a tenant-wide caller.
    //
    // This is the held Option A in packet README §7: protected tier1
    // fixtures build `{ tenantId, userId }` without a membership and
    // expect the old answer, so the full gate will disagree until their
    // owner updates them or marks the genuine system callers with
    // `systemActor: true`.
    return deniedAccess();
  }

  // An INACTIVE OR DELETED membership grants nothing. Checked before the
  // switch and before any role branch, so a revoked manager cannot fall
  // through to the tenant-wide switch or to a forged role claim.
  if (membership.status !== "active" || membership.deleted) {
    return deniedAccess();
  }

  // The membership's role wins. A facility-scoped claim is bound
  // unconditionally, whether the switch is off or on.
  if (isFacilityScopedRoleKey(membership.roleKey)) {
    return resolveFacilityScopedAccess(tx, ctx, membership);
  }

  // ── EVERYBODY ELSE: THE SWITCH GOVERNS, EXACTLY AS TODAY ───────────
  //
  // This preserves the O-08 contract for the receptionist, the coach, the
  // owner and the administrator. The switch is still the only thing that
  // decides whether their membership's named facilities are used.
  if (!(await locationScopedStaffEnabled(tx, ctx.tenantId))) {
    return unrestrictedAccess();
  }

  return resolveMembershipLocationAccess(tx, ctx, membership);
}

// The caller's membership row in THIS tenant, whatever its status.
//
// The lookup is deliberately UNFILTERED:
//
//   • a REVOKED or DELETED membership must still be FOUND, because the
//     role it names is what decides the branch. A revoked manager is
//     recognised as a manager (and therefore denied above), instead of
//     falling through to the tenant-wide switch and being widened.
//   • the status filter moved into the consumer (above), so the answers
//     are the ones today's fallback query gives.
//
// `tenant_memberships_tenant_user_key` is unique on (tenant_id, user_id)
// and is not partial, so there is at most ONE membership row per caller
// per tenant — soft-deleted rows included. The ORDER BY mirrors
// resolveDefaultMembership's rule (role home ordinal, then creation) so
// the row picked here is the row picked there.
export type CallerMembership = {
  id: string;
  roleKey: string;
  allLocations: boolean;
  status: string;
  deleted: boolean;
};

export async function resolveCallerMembership(
  tx: TenantTx,
  ctx: LocationAwareCtx,
): Promise<CallerMembership | null> {
  if (!ctx.userId) return null;
  const rows = await tx
    .select({
      id: tenantMemberships.id,
      allLocations: tenantMemberships.allLocations,
      status: tenantMemberships.status,
      deletedAt: tenantMemberships.deletedAt,
      roleKey: roles.key,
    })
    .from(tenantMemberships)
    .innerJoin(
      roles,
      and(
        eq(roles.id, tenantMemberships.roleId),
        eq(roles.tenantId, ctx.tenantId),
      ),
    )
    .where(
      and(
        eq(tenantMemberships.tenantId, ctx.tenantId),
        eq(tenantMemberships.userId, ctx.userId),
      ),
    )
    .orderBy(asc(roles.homeOrdinal), asc(tenantMemberships.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    roleKey: row.roleKey,
    allLocations: row.allLocations,
    status: row.status,
    deleted: row.deletedAt !== null,
  };
}

// A manager's live membership is authoritative. An explicit all-locations
// appointment resolves the current live facilities each time, while a narrower
// context can only reduce that scope. It remains scoped for leave decisions.
async function resolveFacilityScopedAccess(
  tx: TenantTx,
  ctx: LocationAwareCtx,
  membership: CallerMembership,
): Promise<LocationAccess> {
  if (membership.status !== "active" || membership.deleted) {
    return deniedAccess();
  }

  if (membership.allLocations) {
    const rows = await tx.select({ id: locations.id }).from(locations).where(
      and(eq(locations.tenantId, ctx.tenantId), isNull(locations.deletedAt)),
    );
    const liveIds = rows.map((row) => row.id);
    if (ctx.allLocations === false) {
      if (!Array.isArray(ctx.locationIds)) return deniedAccess();
      return scopedAccess(liveIds.filter((id) => ctx.locationIds?.includes(id)), false);
    }
    return scopedAccess(liveIds, true);
  }

  const rows = await tx
    .select({ locationId: membershipLocations.locationId })
    .from(membershipLocations)
    .where(
      and(
        eq(membershipLocations.tenantId, ctx.tenantId),
        eq(membershipLocations.membershipId, membership.id),
      ),
    );
  const memberScope = rows.map((r) => r.locationId);
  const ctxScope = Array.isArray(ctx.locationIds) ? ctx.locationIds : null;
  if (ctx.allLocations === false && ctxScope === null) {
    // A caller that claims a restricted scope but supplies no list has
    // not narrowed anything. Fail closed rather than hand it the full
    // membership scope.
    return deniedAccess();
  }
  const scope = ctxScope
    ? memberScope.filter((id) => ctxScope.includes(id))
    : memberScope;

  // includeUnlocated is false: a tenant-wide (NULL-location) row is wider
  // than "these facilities", so a facility-scoped caller must not see it.
  return scopedAccess(scope, false);
}

// The membership-derived answer for every OTHER role: the caller's OWN
// facilities, as the tenant-wide switch has always meant it.
//
// The membership is the authority; the ctx may only NARROW:
//
//   • a membership with all_locations = true is the whole club — an
//     explicit, reviewed owner decision, honoured for every role
//     for other roles, which use this function. A ctx that says allLocations:false may still narrow it
//     to the named facilities;
//   • a membership with all_locations = false is exactly the
//     facilities in membership_locations, and an EMPTY list means NO
//     located access, never "all";
//   • `includeUnlocated` is true here because that is the O-08 house
//     rule for non-facility roles: a NULL-location row belongs to the
//     whole business and stays visible to scoped staff. The facility
//     branch above sets it false.
async function resolveMembershipLocationAccess(
  tx: TenantTx,
  ctx: LocationAwareCtx,
  membership: CallerMembership,
): Promise<LocationAccess> {
  if (membership.status !== "active" || membership.deleted) {
    return deniedAccess();
  }

  const ctxScope = Array.isArray(ctx.locationIds) ? ctx.locationIds : null;

  if (membership.allLocations) {
    // A ctx that narrows to a facility list is honoured; a ctx that
    // claims allLocations:true cannot widen a scoped membership below.
    if (ctx.allLocations === false) {
      if (!ctxScope) return deniedAccess();
      return scopedAccess([...ctxScope], true);
    }
    return unrestrictedAccess();
  }

  const rows = await tx
    .select({ locationId: membershipLocations.locationId })
    .from(membershipLocations)
    .where(
      and(
        eq(membershipLocations.tenantId, ctx.tenantId),
        eq(membershipLocations.membershipId, membership.id),
      ),
    );
  const memberScope = rows.map((r) => r.locationId);

  if (ctx.allLocations === false) {
    if (!ctxScope) return deniedAccess();
    return scopedAccess(
      memberScope.filter((id) => ctxScope.includes(id)),
      true,
    );
  }

  // ctx.allLocations === true (or omitted) cannot widen the membership;
  // the membership's named facilities are the answer.
  return scopedAccess(memberScope, true);
}

// Post-fetch visibility for by-id paths (the "scoping the list, not the
// direct path" failure class).
//
// A NULL location is tenant-wide. It is visible only when the access
// answer says so (`unrestricted` or includeUnlocated); a denied caller
// sees nothing, and a facility-scoped caller sees only its own facilities.
export function locationVisible(
  access: LocationAccess,
  locationId: string | null | undefined,
): boolean {
  if (access.unrestricted) return true;
  if (access.denied) return false;
  if (locationId === null || locationId === undefined) {
    return access.includeUnlocated;
  }
  return access.locationIds.includes(locationId);
}

// Query predicate for list paths. Returns undefined when unrestricted so
// callers can push it conditionally.
//
//   • denied          → `false`: no row, including NULL-location rows;
//   • empty scope     → NULL-location rows only when includeUnlocated,
//                       otherwise `false`;
//   • non-empty scope → the named facilities, plus NULL-location rows only
//                       when includeUnlocated.
export function locationPredicate(
  column: PgColumn,
  access: LocationAccess,
): SQL | undefined {
  if (access.unrestricted) return undefined;
  if (access.denied) return sql`false`;
  if (access.locationIds.length === 0) {
    return access.includeUnlocated ? isNull(column) : sql`false`;
  }
  const located = inArray(column, access.locationIds);
  return access.includeUnlocated ? or(located, isNull(column)) : located;
}
