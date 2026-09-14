import { and, asc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { TenantTx } from "@/db/tenant";
import { resolveConfigInTx } from "@/db/config";
import { membershipLocations, tenantMemberships } from "@/db/schema/memberships";
import { roles } from "@/db/schema/roles";
import type { ActionCtx } from "@/lib/auth/context";

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
// writes. Memberships with all_locations = true stay unrestricted, and
// a caller with no user identity (jobs) is never scoped.
//
// Tenant-wide rows (a batch or session with location_id IS NULL) stay
// visible to scoped staff: NULL means "the whole business", not
// "another site".

export const LOCATION_SCOPED_STAFF_KEY = "access.location_scoped_staff" as const;

export type LocationAccess =
  | { unrestricted: true }
  | { unrestricted: false; locationIds: string[] };

// The full Ctx carries allLocations/locationIds; the narrowed ActionCtx
// does not. Accept the widened shape and fall back to a database
// lookup when the fields are absent (internal callers, tests).
export type LocationAwareCtx = ActionCtx & {
  allLocations?: boolean;
  locationIds?: string[];
};

export async function resolveLocationAccess(
  tx: TenantTx,
  ctx: LocationAwareCtx,
): Promise<LocationAccess> {
  const { value: enabled } = await resolveConfigInTx<boolean>(
    tx,
    ctx.tenantId,
    LOCATION_SCOPED_STAFF_KEY,
  );
  if (enabled !== true) return { unrestricted: true };

  if (ctx.allLocations === true) return { unrestricted: true };
  if (ctx.allLocations === false && Array.isArray(ctx.locationIds)) {
    return { unrestricted: false, locationIds: ctx.locationIds };
  }

  // No user identity: a job or system caller — never scoped.
  if (!ctx.userId) return { unrestricted: true };

  // Fallback: the caller's default membership, mirroring
  // resolveDefaultCtx's ordering (role home ordinal, then creation).
  const membershipRows = await tx
    .select({
      id: tenantMemberships.id,
      allLocations: tenantMemberships.allLocations,
    })
    .from(tenantMemberships)
    .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
    .where(
      and(
        eq(tenantMemberships.tenantId, ctx.tenantId),
        eq(tenantMemberships.userId, ctx.userId),
        isNull(tenantMemberships.deletedAt),
      ),
    )
    .orderBy(asc(roles.homeOrdinal), asc(tenantMemberships.createdAt))
    .limit(1);
  const membership = membershipRows[0];
  if (!membership) {
    // Authenticated but not a member of this tenant: deny, do not widen.
    return { unrestricted: false, locationIds: [] };
  }
  if (membership.allLocations) return { unrestricted: true };

  const rows = await tx
    .select({ locationId: membershipLocations.locationId })
    .from(membershipLocations)
    .where(
      and(
        eq(membershipLocations.tenantId, ctx.tenantId),
        eq(membershipLocations.membershipId, membership.id),
      ),
    );
  return { unrestricted: false, locationIds: rows.map((r) => r.locationId) };
}

// Post-fetch visibility for by-id paths (the "scoping the list, not the
// direct path" failure class): a NULL location is tenant-wide and
// visible; anything else must be in the caller's list.
export function locationVisible(
  access: LocationAccess,
  locationId: string | null | undefined,
): boolean {
  if (access.unrestricted) return true;
  if (locationId === null || locationId === undefined) return true;
  return access.locationIds.includes(locationId);
}

// Query predicate for list paths. Returns undefined when unrestricted so
// callers can push it conditionally. NULL locations stay visible.
export function locationPredicate(
  column: PgColumn,
  access: LocationAccess,
): SQL | undefined {
  if (access.unrestricted) return undefined;
  if (access.locationIds.length === 0) return isNull(column);
  return or(inArray(column, access.locationIds), isNull(column));
}
