import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { sessions, enrolments } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { locations } from "@/db/schema/locations";
import { staff } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";

// U-04 — the owner schedule grid. A read over the existing
// C-17/C-19 data: sessions joined to their batch for capacity, with
// the enrolled count against that capacity (the lane strip) and the
// per-location filter. No new session model, no writes here — the
// add-session entry point leads to the batch editor, because sessions
// are materialised from a batch's recurrence.

export type GridSessionRow = {
  id: string;
  sessionDate: string;
  startsAt: string;
  endsAt: string;
  status: string;
  batchId: string;
  batchName: string;
  capacity: number;
  enrolled: number;
  locationId: string | null;
  locationName: string | null;
  coachName: string | null;
};

export const gridRangeInput = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locationId: z.string().uuid().optional(),
});

export async function getScheduleGrid(
  ctx: ActionCtx,
  raw: unknown,
): Promise<GridSessionRow[]> {
  const parsed = gridRangeInput.safeParse(raw);
  if (!parsed.success) return [];

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const conditions = [
      eq(sessions.tenantId, ctx.tenantId),
      isNull(batches.deletedAt),
      gte(sessions.sessionDate, parsed.data.fromDate),
      lte(sessions.sessionDate, parsed.data.toDate),
    ];
    if (parsed.data.locationId) {
      conditions.push(eq(sessions.locationId, parsed.data.locationId));
    } else {
      const predicate = locationPredicate(sessions.locationId, access);
      if (predicate) conditions.push(predicate);
    }

    const rows = await tx
      .select({
        id: sessions.id,
        sessionDate: sessions.sessionDate,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        status: sessions.status,
        batchId: batches.id,
        batchName: batches.name,
        capacity: batches.capacity,
        enrolled: sql<number>`(
          select count(distinct e.member_id)::int from ${enrolments} e
          where e.tenant_id = ${ctx.tenantId}
            and e.batch_id = ${sessions.batchId}
            and e.enrolled_on <= ${sessions.sessionDate}
        )`,
        locationId: sessions.locationId,
        locationName: locations.name,
        coachName: persons.fullName,
      })
      .from(sessions)
      .innerJoin(
        batches,
        and(eq(batches.id, sessions.batchId), eq(batches.tenantId, ctx.tenantId)),
      )
      .leftJoin(
        locations,
        and(eq(locations.id, sessions.locationId), eq(locations.tenantId, ctx.tenantId)),
      )
      .leftJoin(
        staff,
        and(eq(staff.id, sessions.coachId), eq(staff.tenantId, ctx.tenantId)),
      )
      .leftJoin(persons, eq(persons.id, staff.personId))
      .where(and(...conditions))
      .orderBy(sessions.sessionDate, sessions.startsAt);

    return rows.map((r) => ({
      id: r.id,
      sessionDate: r.sessionDate,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      status: r.status,
      batchId: r.batchId,
      batchName: r.batchName,
      capacity: r.capacity,
      enrolled: Number(r.enrolled),
      locationId: r.locationId,
      locationName: r.locationName,
      coachName: r.coachName,
    }));
  });
}
