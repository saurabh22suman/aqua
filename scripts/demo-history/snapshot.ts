import { and, asc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { locations } from "@/db/schema/locations";
import { members } from "@/db/schema/people";
import { batches } from "@/db/schema/programs";
import { enrolments } from "@/db/schema/scheduling";
import { tenantHolidays } from "@/db/schema/tenant-holidays";
import { membershipPlans } from "@/db/schema/membership-plans";
import { staff } from "@/db/schema/staff";
import { planShapes, facilities } from "@/db/schema/preset-engine";
import { todayInZone } from "@/lib/time/tz";
import { toSafePaise } from "@/lib/money/safe-paise";
import { asTenantId } from "@/lib/ids";
import type { TenantSnapshot } from "./types";

// The reader: one tenant's current state, in the shape the planner
// wants. Everything is read inside withTenant(), so the reads are
// RLS-scoped to the one tenant and the same policy the application
// itself runs under applies.

export type TenantState = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    gstin: string | null;
  };
  primaryLocationId: string;
  facilityId: string | null;
  members: TenantSnapshot["members"];
  batches: TenantSnapshot["batches"];
  holidays: string[];
  plans: TenantSnapshot["plans"];
  receiverUserId: string | null;
  planShapes: { id: string; name: string; kind: string; durationDays: number | null }[];
};

export async function readTenantState(
  tenantId: string,
): Promise<TenantState> {
  return withTenant(tenantId, async (tx) => {
    const [tenantRow] = await tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        timezone: tenants.timezone,
        gstin: tenants.gstin,
      })
      .from(tenants)
      .where(eq(tenants.id, asTenantId(tenantId)))
      .limit(1);
    if (!tenantRow) throw new Error(`readTenantState: tenant ${tenantId} not found`);

    const locationRows = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, asTenantId(tenantId)),
          eq(locations.isPrimary, true),
          isNull(locations.deletedAt),
        ),
      )
      .limit(1);
    const primaryLocationId = locationRows[0]?.id;
    if (!primaryLocationId) {
      throw new Error(`readTenantState: tenant ${tenantId} has no primary location`);
    }

    const memberRows = await tx
      .select({
        id: members.id,
        code: members.memberCode,
        status: members.status,
        locationId: members.locationId,
      })
      .from(members)
      .where(
        and(
          eq(members.tenantId, asTenantId(tenantId)),
          isNull(members.deletedAt),
        ),
      )
      .orderBy(asc(members.memberCode));

    const batchRows = await tx
      .select({
        id: batches.id,
        name: batches.name,
        daysOfWeek: batches.daysOfWeek,
        startTime: batches.startTime,
        endTime: batches.endTime,
        capacity: batches.capacity,
        locationId: batches.locationId,
        coachId: batches.coachId,
      })
      .from(batches)
      .where(
        and(
          eq(batches.tenantId, asTenantId(tenantId)),
          isNull(batches.deletedAt),
        ),
      )
      .orderBy(asc(batches.name));

    const enrolmentRows = await tx
      .select({ batchId: enrolments.batchId, memberId: enrolments.memberId })
      .from(enrolments)
      .where(eq(enrolments.tenantId, asTenantId(tenantId)));
    const membersByBatch = new Map<string, string[]>();
    for (const row of enrolmentRows) {
      const list = membersByBatch.get(row.batchId) ?? [];
      list.push(row.memberId);
      membersByBatch.set(row.batchId, list);
    }

    const holidayRows = await tx
      .select({ date: tenantHolidays.holidayDate })
      .from(tenantHolidays)
      .where(eq(tenantHolidays.tenantId, asTenantId(tenantId)));

    const planRows = await tx
      .select({
        id: membershipPlans.id,
        name: membershipPlans.name,
        amountPaise: membershipPlans.amountPaise,
        durationDays: membershipPlans.durationDays,
        kind: membershipPlans.kind,
        sourceShapeId: membershipPlans.sourceShapeId,
        locationId: membershipPlans.locationId,
        activityId: membershipPlans.activityId,
      })
      .from(membershipPlans)
      .where(
        and(
          eq(membershipPlans.tenantId, asTenantId(tenantId)),
          eq(membershipPlans.isActive, true),
          isNull(membershipPlans.deletedAt),
        ),
      )
      .orderBy(asc(membershipPlans.name));

    const shapeRows = await tx
      .select({
        id: planShapes.id,
        name: planShapes.name,
        kind: planShapes.kind,
        durationDays: planShapes.durationDays,
      })
      .from(planShapes)
      .where(eq(planShapes.tenantId, asTenantId(tenantId)))
      .orderBy(asc(planShapes.name));

    const facilityRows = await tx
      .select({ id: facilities.id })
      .from(facilities)
      .where(
        and(
          eq(facilities.tenantId, asTenantId(tenantId)),
          isNull(facilities.deletedAt),
        ),
      )
      .limit(1);

    // The desk that records the money: a staff row's user id. Read
    // through `staff`, never through the global users table. The
    // reception desk is preferred — that is who takes the money at the
    // counter — with any other staff row as the fallback.
    const staffRows = await tx
      .select({ userId: staff.userId, staffType: staff.staffType })
      .from(staff)
      .where(
        and(
          eq(staff.tenantId, asTenantId(tenantId)),
          isNull(staff.deletedAt),
        ),
      )
      .limit(20);

    return {
      tenant: {
        id: tenantRow.id,
        slug: tenantRow.slug,
        name: tenantRow.name,
        timezone: tenantRow.timezone,
        gstin: tenantRow.gstin,
      },
      primaryLocationId,
      facilityId: facilityRows[0]?.id ?? null,
      members: memberRows.map((row) => ({
        id: row.id,
        code: row.code,
        status: row.status as TenantSnapshot["members"][number]["status"],
        locationId: row.locationId,
      })),
      batches: batchRows.map((row) => ({
        id: row.id,
        name: row.name,
        daysOfWeek: row.daysOfWeek,
        startTime: row.startTime,
        endTime: row.endTime,
        capacity: row.capacity,
        locationId: row.locationId,
        coachId: row.coachId,
        memberIds: membersByBatch.get(row.id) ?? [],
      })),
      holidays: holidayRows.map((row) => row.date),
      plans: planRows.map((row) => ({
        id: row.id,
        name: row.name,
        amountPaise: toSafePaise(row.amountPaise),
        durationDays: row.durationDays,
        kind: row.kind as TenantSnapshot["plans"][number]["kind"],
        sourceShapeId: row.sourceShapeId,
        locationId: row.locationId,
        activityId: row.activityId,
        proposed: false,
      })),
      receiverUserId:
        staffRows.find((row) => row.staffType === "receptionist" && row.userId)
          ?.userId ??
        staffRows.find((row) => row.userId)?.userId ??
        null,
      planShapes: shapeRows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        durationDays: row.durationDays,
      })),
    };
  });
}

/** The tenant's local today — the anchor the whole window hangs off. */
export function anchorFor(state: TenantState, nowMs: number): string {
  return todayInZone(state.tenant.timezone, nowMs);
}
