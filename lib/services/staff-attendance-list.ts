import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import {
  staffAttendance,
  type StaffAttendanceMethod,
  type StaffAttendanceStatus,
} from "@/db/schema/staff-attendance";
import { shifts } from "@/db/schema/shifts";
import { staff } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
import type { ActionCtx } from "@/lib/auth/context";

// V-24 — the read side of staff attendance: the reception desk's day
// board and the caller's own row. Kept out of the mutation service so
// each file stays reviewable.

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const dayInput = z.object({
  date: isoDate,
  locationId: uuid.optional(),
});

export const myAttendanceInput = z.object({
  date: isoDate,
});

export type StaffAttendanceDayRow = {
  staffId: string;
  staffName: string;
  staffType: string;
  shiftStartAt: string | null;
  shiftEndAt: string | null;
  status: StaffAttendanceStatus | null;
  lateMinutes: number;
  method: StaffAttendanceMethod | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  note: string | null;
};

export type MyAttendanceRow = {
  id: string;
  workDate: string;
  status: StaffAttendanceStatus;
  lateMinutes: number;
  method: StaffAttendanceMethod;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  note: string | null;
};

export async function listStaffAttendanceDay(
  ctx: ActionCtx,
  raw: unknown,
): Promise<StaffAttendanceDayRow[]> {
  const parsed = dayInput.safeParse(raw);
  if (!parsed.success) return [];
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const staffRows = await tx
      .select({
        id: staff.id,
        name: persons.fullName,
        staffType: staff.staffType,
      })
      .from(staff)
      .innerJoin(persons, eq(persons.id, staff.personId))
      .where(and(eq(staff.tenantId, ctx.tenantId), isNull(staff.deletedAt)))
      .orderBy(asc(persons.fullName));

    const attendanceRows = await tx
      .select()
      .from(staffAttendance)
      .where(
        and(
          eq(staffAttendance.tenantId, ctx.tenantId),
          eq(staffAttendance.workDate, input.date),
        ),
      );
    const byStaff = new Map(attendanceRows.map((r) => [r.staffId, r]));

    const shiftConditions = [
      eq(shifts.tenantId, ctx.tenantId),
      eq(shifts.shiftDate, input.date),
    ];
    if (input.locationId) {
      shiftConditions.push(eq(shifts.locationId, input.locationId));
    }
    const shiftRows = await tx
      .select({
        staffId: shifts.staffId,
        startAt: shifts.startAt,
        endAt: shifts.endAt,
      })
      .from(shifts)
      .where(and(...shiftConditions))
      .orderBy(asc(shifts.startAt));
    const firstShift = new Map<string, { startAt: Date; endAt: Date }>();
    for (const row of shiftRows) {
      if (!firstShift.has(row.staffId)) {
        firstShift.set(row.staffId, { startAt: row.startAt, endAt: row.endAt });
      }
    }

    return staffRows.map((s) => {
      const att = byStaff.get(s.id);
      const shift = firstShift.get(s.id);
      return {
        staffId: s.id,
        staffName: s.name,
        staffType: s.staffType,
        shiftStartAt: shift?.startAt.toISOString() ?? null,
        shiftEndAt: shift?.endAt.toISOString() ?? null,
        status: (att?.status as StaffAttendanceStatus | undefined) ?? null,
        lateMinutes: att?.lateMinutes ?? 0,
        method: (att?.method as StaffAttendanceMethod | undefined) ?? null,
        checkedInAt: att?.checkedInAt?.toISOString() ?? null,
        checkedOutAt: att?.checkedOutAt?.toISOString() ?? null,
        note: att?.note ?? null,
      };
    });
  });
}

export async function getMyAttendance(
  ctx: ActionCtx,
  raw: unknown,
): Promise<MyAttendanceRow | null> {
  const parsed = myAttendanceInput.safeParse(raw);
  if (!parsed.success) return null;

  return withTenant(ctx.tenantId, async (tx) => {
    const staffId = await ownStaffIdInTx(tx, ctx);
    if (!staffId) return null;
    const [row] = await tx
      .select()
      .from(staffAttendance)
      .where(
        and(
          eq(staffAttendance.tenantId, ctx.tenantId),
          eq(staffAttendance.staffId, staffId),
          eq(staffAttendance.workDate, parsed.data.date),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      workDate: row.workDate,
      status: row.status as StaffAttendanceStatus,
      lateMinutes: row.lateMinutes,
      method: row.method as StaffAttendanceMethod,
      checkedInAt: row.checkedInAt?.toISOString() ?? null,
      checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
      note: row.note,
    };
  });
}
