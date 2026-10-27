import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { facilities } from "@/db/schema/preset-engine";
import {
  locationVisible,
  type LocationAccess,
} from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";
import type { TenantId } from "@/lib/ids";

// Batch 6 — the WRITE-SCOPE policy for booking price rules.
//
// One policy, stated once, used by every write path
// (lib/services/booking-price-writes.ts). It answers two questions:
//
//   1. May this caller reach this FACILITY?
//   2. May this caller reach this RULE where it stands?
//
// Question 2 is the one that was missing: a rule id is not an
// authorisation. Loading a rule by id and then checking only the
// DESTINATION facility let a location-restricted caller relocate
// another location's rule into its own location, or claim a
// tenant-wide rule by pointing it at its own facility.
//
// The refusal message is deliberately "Price rule not found." — a
// caller who may not reach a rule learns nothing about whether it
// exists.

export async function facilityFor(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: TenantId,
  facilityId: string,
): Promise<{ id: string; locationId: string; name: string } | undefined> {
  const [row] = await tx
    .select({
      id: facilities.id,
      locationId: facilities.locationId,
      name: facilities.name,
    })
    .from(facilities)
    .where(
      and(
        eq(facilities.id, facilityId),
        eq(facilities.tenantId, tenantId),
        isNull(facilities.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

// Can this caller write THIS rule where it stands?
//
// A rule attached to a facility inherits that facility's location. A
// tenant-wide rule (facility_id NULL) reaches every location, so only
// a caller that reaches every location may change it.
//
// Returns a refusal message, or null when the rule is reachable.
export async function authoriseRuleAccess(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  ctx: ActionCtx,
  access: LocationAccess,
  rule: { facilityId: string | null },
): Promise<string | null> {
  if (rule.facilityId) {
    const facility = await facilityFor(tx, ctx.tenantId, rule.facilityId);
    if (!facility || !locationVisible(access, facility.locationId)) {
      return "Price rule not found.";
    }
    return null;
  }
  if (!access.unrestricted) return "Price rule not found.";
  return null;
}
