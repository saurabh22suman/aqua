import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { staffAttendance } from "@/db/schema/staff-attendance";
import { staff } from "@/db/schema/staff";
import { writeAudit } from "@/lib/audit/write";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
import { asStaffId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// V-24 — the audited manual correction. Split from the check-in/out
// service because this is the path that must answer "who corrected
// this and why": the reason is required, `marked_by` is the correcting
// staff member, and the audit row carries before/after.

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const correctionInput = z.object({
  staffId: uuid,
  workDate: isoDate,
  status: z.enum(["present", "absent", "half_day", "leave", "holiday"]),
  note: z.string().trim().min(1, "A correction needs a reason.").max(500),
  checkedInAt: z.string().datetime({ offset: true }).nullish(),
  checkedOutAt: z.string().datetime({ offset: true }).nullish(),
  lateMinutes: z.number().int().min(0).max(1440).optional(),
});

export type AttendanceResult =
  | { ok: true; attendanceId: string }
  | { ok: false; error: string };

export async function correctAttendance(
  ctx: ActionCtx,
  raw: unknown,
): Promise<AttendanceResult> {
  const parsed = correctionInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid attendance input.",
    };
  }
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const marker = await ownStaffIdInTx(tx, ctx);
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
