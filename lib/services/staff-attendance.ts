import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { staffAttendance } from "@/db/schema/staff-attendance";
import { shifts } from "@/db/schema/shifts";
import { writeAudit } from "@/lib/audit/write";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import { todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

// V-24 — staff attendance mutations (architecture.md §8.9). The read
// side (day board, own row) lives in ./staff-attendance-list and is
// re-exported below.
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

export * from "./staff-attendance-list";
export * from "./staff-attendance-correction";

const uuid = z.string().uuid();

export const checkInInput = z.object({
  method: z.enum(["self_app", "self_qr"]),
  shiftId: uuid.nullish(),
  clientId: z.string().trim().min(1).max(120).optional(),
});

export type CheckInResult =
  | { ok: true; attendanceId: string; status: string; lateMinutes: number }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid attendance input.";
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
    const staffId = await ownStaffIdInTx(tx, ctx);
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
    const staffId = await ownStaffIdInTx(tx, ctx);
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
