import type { ActionCtx } from "@/lib/auth/context";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { batches, programs } from "@/db/schema/programs";
import { enrolments } from "@/db/schema/scheduling";
import { locations } from "@/db/schema/locations";
import { assertInsightAccess, assertInsightGrant } from "@/lib/services/owner-insights-access";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";

export type OwnerBatchRow = {
  batchId: string; batchName: string; programName: string;
  locationId: string | null; locationName: string | null;
  capacity: number; reservedPlaces: number;
};

export async function getOwnerBatchReport(ctx: ActionCtx, locationId?: string): Promise<OwnerBatchRow[]> {
  const selected = z.string().uuid().optional().parse(locationId);
  await assertInsightAccess(ctx);
  return withTenant(ctx.tenantId, async (tx) => {
    await assertInsightGrant(tx, ctx);
    const access = await resolveLocationAccess(tx, ctx);
    const predicate = locationPredicate(batches.locationId, access);
    return tx.select({
      batchId: batches.id, batchName: batches.name, programName: programs.name,
      locationId: batches.locationId, locationName: locations.name, capacity: batches.capacity,
      reservedPlaces: sql<number>`(select count(distinct e.member_id)::int from ${enrolments} e where e.tenant_id = ${ctx.tenantId} and e.batch_id = ${batches.id})`,
    }).from(batches)
      .innerJoin(programs, and(eq(programs.id, batches.programId), eq(programs.tenantId, ctx.tenantId)))
      .leftJoin(locations, and(eq(locations.id, batches.locationId), eq(locations.tenantId, ctx.tenantId)))
      .where(and(eq(batches.tenantId, ctx.tenantId), isNull(batches.deletedAt), predicate,
        selected ? eq(batches.locationId, selected) : undefined))
      .orderBy(programs.name, batches.name, batches.id);
  });
}
