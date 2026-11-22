import type { Ctx } from "@/lib/auth/context";
import { and, eq, exists, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { members } from "@/db/schema/people";
import { memberFacilityOptins } from "@/db/schema/facility-optins";
import { staffAttendance } from "@/db/schema/staff-attendance";
import { shifts } from "@/db/schema/shifts";
import { requirePermission } from "@/lib/auth/permission";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";

export type PeopleReportRange = { from: string; to: string; locationId?: string };
export type MembersReport = { statuses: Array<{ status: string; count: number }>; joined: number; joinedUnknown: number; joinedByDay: Array<{ date: string; count: number }> };
export type StaffReport = { attendance: Array<{ date: string; status: string; locationId: string | null; checkedIn: boolean }>; shifts: Array<{ date: string; status: string; locationId: string }> };

export async function getStaffReport(ctx: Ctx, range: PeopleReportRange): Promise<StaffReport> {
  requirePermission(ctx, "reports.operational");
  requirePermission(ctx, "staff.attendance");
  const selected = input.parse(range);
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const predicate = locationPredicate(shifts.locationId, access);
    const scoped = selected.locationId ? eq(shifts.locationId, selected.locationId) : undefined;
    const attendance = await tx.select({ date: staffAttendance.workDate, status: staffAttendance.status, locationId: shifts.locationId, checkedIn: sql<boolean>`${staffAttendance.checkedInAt} is not null` })
      .from(staffAttendance)
      .leftJoin(shifts, and(eq(shifts.id, staffAttendance.shiftId), eq(shifts.tenantId, staffAttendance.tenantId)))
      .where(and(eq(staffAttendance.tenantId, ctx.tenantId), gte(staffAttendance.workDate, selected.from), lte(staffAttendance.workDate, selected.to), predicate, scoped, !access.unrestricted ? isNotNull(shifts.locationId) : undefined))
      .orderBy(staffAttendance.workDate);
    const shiftRows = await tx.select({ date: shifts.shiftDate, status: shifts.status, locationId: shifts.locationId })
      .from(shifts).where(and(eq(shifts.tenantId, ctx.tenantId), gte(shifts.shiftDate, selected.from), lte(shifts.shiftDate, selected.to), predicate, scoped)).orderBy(shifts.shiftDate);
    return { attendance, shifts: shiftRows };
  });
}

const input = z.object({ from: z.string().date(), to: z.string().date(), locationId: z.string().uuid().optional() }).refine((v) => v.from <= v.to);

export async function getMembersReport(ctx: Ctx, range: PeopleReportRange): Promise<MembersReport> {
  requirePermission(ctx, "reports.operational");
  const selected = input.parse(range);
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const predicate = locationPredicate(members.locationId, access);
    const facility = selected.locationId ? or(
      eq(members.locationId, selected.locationId),
      exists(tx.select({ one: sql`1` }).from(memberFacilityOptins).where(and(
        eq(memberFacilityOptins.tenantId, ctx.tenantId),
        eq(memberFacilityOptins.memberId, members.id),
        eq(memberFacilityOptins.locationId, selected.locationId),
        isNull(memberFacilityOptins.endedOn),
      ))),
    ) : undefined;
    const base = and(eq(members.tenantId, ctx.tenantId), isNull(members.deletedAt), predicate, facility);
    const statuses = await tx.select({ status: members.status, count: sql<number>`count(*)::int` }).from(members).where(base).groupBy(members.status);
    const [counts] = await tx.select({
      joined: sql<number>`count(*) filter (where ${members.joinedOn} >= ${selected.from} and ${members.joinedOn} <= ${selected.to})::int`,
      joinedUnknown: sql<number>`count(*) filter (where ${members.joinedOn} is null)::int`,
    }).from(members).where(base);
    const joinedByDay = await tx.select({ date: sql<string>`${members.joinedOn}::text`, count: sql<number>`count(*)::int` }).from(members)
      .where(and(base, gte(members.joinedOn, selected.from), lte(members.joinedOn, selected.to)))
      .groupBy(members.joinedOn).orderBy(members.joinedOn);
    return { statuses, joined: counts?.joined ?? 0, joinedUnknown: counts?.joinedUnknown ?? 0, joinedByDay };
  });
}
