import { and, eq, exists, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { TenantTx } from "@/db/tenant";
import { staffLocations } from "@/db/schema/staff-locations";
import type { TenantId } from "@/lib/ids";
import {
  resolveLocationAccess,
  type LocationAccess,
  type LocationAwareCtx,
} from "./location-access";

// The context shape the staff scope accepts: the shared helper's shape. Every
// ActionCtx caller is assignable to it, so widening a service parameter
// changes nothing for an existing caller. The optional fields let a genuine
// background job say `systemActor: true`; the foundation honours that only
// when no userId is present (see location-access.ts).
export type StaffScopeCtx = LocationAwareCtx;

// The scope of a staff read, in the foundation's own vocabulary.
//
//   unrestricted: true  — every staff row in the tenant (owner, all-locations
//                          membership, genuine identity-free system answer).
//   unrestricted: false — only staff attached to `locationIds`. An EMPTY list
//                          means NO staff at all, never "all". `denied` is
//                          the only complete denial.
//
// `includeUnlocated` is carried through from the foundation. It is false for
// the facility-scoped manager and true for the legacy O-08 scoped staff path.
// The day board uses it to choose the legacy answer versus the manager's
// record-evidence answer (see lib/services/staff-attendance-list.ts).
export type StaffScope = LocationAccess;

// Resolve the caller's staff scope through the one shared choke point.
export async function resolveStaffScope(
  tx: TenantTx,
  ctx: StaffScopeCtx,
): Promise<StaffScope> {
  return resolveLocationAccess(tx, ctx);
}

// The list-path predicate.
//
// undefined — unrestricted: no predicate at all, so the owner/all-locations
//             caller keeps the whole club and a genuine system caller keeps
//             its explicit answer.
//
// `false`   — restricted with a denial or an empty facility list: no staff
//             row is reachable. Empty is never treated as "all".
//
// EXISTS    — restricted to the caller's facilities. The test is an EXISTS
//             over `staff_locations`, not a JOIN: a staff member who works at
//             two of the caller's facilities is ONE row, so lists can never
//             multiply.
//
// The tenant is named inside the subquery as defence in depth. The outer
// query must still carry its own tenant predicate; this helper is not a
// substitute for it.
export function staffScopePredicate(
  tx: TenantTx,
  staffIdColumn: PgColumn,
  scope: StaffScope,
  tenantId: TenantId,
): SQL | undefined {
  if (scope.unrestricted) return undefined;
  if (scope.denied || scope.locationIds.length === 0) return sql`false`;
  return exists(
    tx
      .select({ one: sql`1` })
      .from(staffLocations)
      .where(
        and(
          eq(staffLocations.tenantId, tenantId),
          eq(staffLocations.staffId, staffIdColumn),
          inArray(staffLocations.locationId, scope.locationIds),
        ),
      ),
  );
}
