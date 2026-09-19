import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import {
  staffAttendance,
  type StaffAttendanceMethod,
  type StaffAttendanceStatus,
} from "@/db/schema/staff-attendance";
import { shifts } from "@/db/schema/shifts";
import { staff } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import { todayInZone } from "@/lib/time/tz";
import { asStaffId, type StaffId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// V-24 — staff attendance (architecture.md §8.9).
//
// One row per staff member per work date. Self check-in resolves the
// caller's OWN staff row from ctx.userId — a caller can never check in
// someone else through this path, and `marked_by` is written only by
// the manual-correction path (with a required reason), so the row
// always answers "who recorded this and why".
//
// Late minutes are measured against the shift named on the check-in
// (or the day's first shift when none is named) and stored at that
// moment; a later roster edit never rewrites the recorded history.

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const checkInInput = z.object({
  method: z.enum(["self_app", "self_qr"]),
  shiftId: uuid.nullish(),
  clientId: z.string().trim().min(1).max(120).optional(),
});

export const correctionInput = z.object({
  staffId: uuid,
  workDate: isoDate,
  status: z.enum(["present", "absent", "half_day", "leave", "holiday"]),
  note: z.string().trim().min(1, "A correction needs a reason.").max(500),
  checkedInAt: z.string().datetime({ offset: true }).nullish(),
  checkedOutAt: z.string().datetime({ offset: true }).nullish(),
  lateMinutes: z.number().int().min(0).max(1440).optional(),
});

export const dayInput = z.object({
  date: isoDate,
  locationId: uuid.optional(),
});

export const myAttendanceInput = z.object({
  date: isoDate,
});

export type CheckInResult =
  | { ok: true; attendanceId: string; status: string; lateMinutes: number }
  | { ok: false; error: string };

export type AttendanceResult =
  | { ok: true; attendanceId: string }
  | { ok: false; error: string };

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

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid attendance input.";
}

async function ownStaffId(tx: TenantTx, ctx: ActionCtx): Promise<StaffId | null> {
  if (!ctx.userId) return null;
  const [row] = await tx
    .select({ id: staff.id })
    .from(staff)
    .where(
      and(
        eq(staff.tenantId, ctx.tenantId),
        eq(staff.userId, ctx.userId),
        isNull(staff.deletedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

function lateMinutesAgainst(startAt: Date | null, now: Date): number {
  if (!startAt || startAt >= now) return 0;
  return Math.floor((now.getTime() - startAt.getTime()) / 60_000);
}

export async function checkIn(
  ctx: ActionCtx,
  raw: unknown,
): Promise<CheckInResult> {
  const parsed = checkInInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const staffId = await ownStaffId(tx, ctx);
    if (!staffId) {
      return { ok: false, error: "Your login is not linked to a staff record." };
    }

    const timezone = await tenantTimezoneInTx(tx, ctx.tenantId);
    const workDate = todayInZone(timezone);
    const now = new Date();

    let shift: { id: string; startAt: Date } | undefined;
    if (input.shiftId) {
      [shift] = await tx
        .select({ id: shifts.id, startAt: shifts.startAt })
        .from(shifts)
        .where(
          and(
            eq(shifts.id, input.shiftId),
            eq(shifts.tenantId, ctx.tenantId),
            eq(shifts.staffId, staffId),
          ),
        )
        .limit(1);
      if (!shift) return { ok: false, error: "Shift not found." };
    } else {
      [shift] = await tx
        .select({ id: shifts.id, startAt: shifts.startAt })
        .from(shifts)
        .where(
          and(
            eq(shifts.tenantId, ctx.tenantId),
            eq(shifts.staffId, staffId),
            eq(shifts.shiftDate, workDate),
          ),
        )
        .orderBy(asc(shifts.startAt))
        .limit(1);
    }

    const late = lateMinutesAgainst(shift?.startAt ?? null, now);

    let inserted: { id: string } | undefined;
    try {
      [inserted] = await tx
        .insert(staffAttendance)
        .values({
          tenantId: ctx.tenantId,
          staffId,
          shiftId: shift?.id ?? null,
          workDate,
          checkedInAt: now,
          method: input.method,
          lateMinutes: late,
          status: "present",
          clientId: input.clientId ?? `${input.method}:${staffId}:${workDate}`,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: staffAttendance.id });
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === "23505") {
        return { ok: false, error: "You have already checked in today." };
      }
      if (code === "23503" || code === "23514") {
        return { ok: false, error: "The check-in could not be saved." };
      }
      throw error;
    }
    if (!inserted) return { ok: false, error: "The check-in could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "staff.attendance.check_in",
      entityType: "staff_attendance",
      entityId: inserted.id,
      after: {
        staffId,
        workDate,
        method: input.method,
        status: "present",
        lateMinutes: late,
        shiftId: shift?.id ?? null,
      },
    });

    return {
      ok: true,
      attendanceId: inserted.id,
      status: "present",
      lateMinutes: late,
    };
  });
}

export async function checkOut(ctx: ActionCtx): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const staffId = await ownStaffId(tx, ctx);
    if (!staffId) {
      return { ok: false, error: "Your login is not linked to a staff record." };
    }
    const timezone = await tenantTimezoneInTx(tx, ctx.tenantId);
    const workDate = todayInZone(timezone);

    const [row] = await tx
      .select()
      .from(staffAttendance)
      .where(
        and(
          eq(staffAttendance.tenantId, ctx.tenantId),
          eq(staffAttendance.staffId, staffId),
          eq(staffAttendance.workDate, workDate),
        ),
      )
      .for("update");
    if (!row || !row.checkedInAt) {
      return { ok: false, error: "You have not checked in today." };
    }
    if (row.checkedOutAt) {
      return { ok: false, error: "You have already checked out." };
    }

    const now = new Date();
    await tx
      .update(staffAttendance)
      .set({ checkedOutAt: now, updatedBy: ctx.userId })
      .where(
        and(
          eq(staffAttendance.id, row.id),
          eq(staffAttendance.tenantId, ctx.tenantId),
        ),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "staff.attendance.check_out",
      entityType: "staff_attendance",
      entityId: row.id,
      before: { checkedOutAt: null },
      after: { checkedOutAt: now.toISOString() },
    });

    return { ok: true };
  });
}

export async function correctAttendance(
  ctx: ActionCtx,
  raw: unknown,
): Promise<AttendanceResult> {
  const parsed = correctionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const marker = await ownStaffId(tx, ctx);
    if (!marker) {
      return { ok: false, error: "Your login is not linked to a staff record." };
    }

    const [target] = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(
        and(
          eq(staff.id, asStaffId(input.staffId)),
          eq(staff.tenantId, ctx.tenantId),
          isNull(staff.deletedAt),
        ),
      )
      .limit(1);
    if (!target) return { ok: false, error: "Staff member not found." };

    const checkedInAt = input.checkedInAt ? new Date(input.checkedInAt) : null;
    const checkedOutAt = input.checkedOutAt ? new Date(input.checkedOutAt) : null;
    if (checkedOutAt && !checkedInAt) {
      return {
        ok: false,
        error: "A check-out needs a check-in time on the same correction.",
      };
    }

    const [existing] = await tx
      .select()
      .from(staffAttendance)
      .where(
        and(
          eq(staffAttendance.tenantId, ctx.tenantId),
          eq(staffAttendance.staffId, target.id),
          eq(staffAttendance.workDate, input.workDate),
        ),
      )
      .for("update");

    const values = {
      method: "manual" as const,
      markedBy: marker,
      status: input.status,
      note: input.note,
      checkedInAt: checkedInAt ?? existing?.checkedInAt ?? null,
      checkedOutAt: checkedOutAt ?? existing?.checkedOutAt ?? null,
      lateMinutes: input.lateMinutes ?? existing?.lateMinutes ?? 0,
      updatedBy: ctx.userId,
    };

    if (!values.checkedInAt && values.checkedOutAt) {
      return {
        ok: false,
        error: "A check-out needs a check-in time on the same correction.",
      };
    }

    let attendanceId: string;
    if (existing) {
      const [updated] = await tx
        .update(staffAttendance)
        .set(values)
        .where(
          and(
            eq(staffAttendance.id, existing.id),
            eq(staffAttendance.tenantId, ctx.tenantId),
          ),
        )
        .returning({ id: staffAttendance.id });
      if (!updated) return { ok: false, error: "The correction could not be saved." };
      attendanceId = updated.id;

      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        requestId: ctx.requestId ?? null,
        action: "staff.attendance.correct",
        entityType: "staff_attendance",
        entityId: attendanceId,
        before: {
          status: existing.status,
          method: existing.method,
          note: existing.note,
          lateMinutes: existing.lateMinutes,
        },
        after: {
          staffId: input.staffId,
          workDate: input.workDate,
          status: input.status,
          method: "manual",
          note: input.note,
          lateMinutes: values.lateMinutes,
          markedBy: marker,
        },
      });
    } else {
      const [inserted] = await tx
        .insert(staffAttendance)
        .values({
          tenantId: ctx.tenantId,
          staffId: target.id,
          workDate: input.workDate,
          ...values,
          clientId: `manual:${target.id}:${input.workDate}`,
          createdBy: ctx.userId,
        })
        .returning({ id: staffAttendance.id });
      if (!inserted) return { ok: false, error: "The correction could not be saved." };
      attendanceId = inserted.id;

      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        requestId: ctx.requestId ?? null,
        action: "staff.attendance.correct",
        entityType: "staff_attendance",
        entityId: attendanceId,
        after: {
          staffId: input.staffId,
          workDate: input.workDate,
          status: input.status,
          method: "manual",
          note: input.note,
          lateMinutes: values.lateMinutes,
          markedBy: marker,
        },
      });
    }

    return { ok: true, attendanceId };
  });
}

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
    const staffId = await ownStaffId(tx, ctx);
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

// Drizzle wraps driver errors; the SQLSTATE lives on the cause chain.
function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== "object" || current === null) return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
