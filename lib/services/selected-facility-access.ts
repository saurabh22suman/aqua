import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { locations } from "@/db/schema/locations";
import { locationVisible, resolveLocationAccess, type LocationAwareCtx } from "@/lib/services/location-access";

/** A named selection is usable only while both membership and facility remain live. */
export async function canSelectFacility(ctx: LocationAwareCtx, locationId: string): Promise<boolean> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, locationId)) return false;
    const rows = await tx.select({ id: locations.id }).from(locations).where(and(
      eq(locations.tenantId, ctx.tenantId), eq(locations.id, locationId), isNull(locations.deletedAt),
    )).limit(1);
    return rows.length === 1;
  });
}
