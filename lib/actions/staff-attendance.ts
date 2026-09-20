"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  checkIn,
  checkInInput,
  checkOut,
  correctAttendance,
  correctionInput,
  dayInput,
  getMyAttendance,
  listStaffAttendanceDay,
  myAttendanceInput,
  type AttendanceResult,
  type CheckInResult,
  type MyAttendanceRow,
  type StaffAttendanceDayRow,
} from "@/lib/services/staff-attendance";

// V-24 — staff attendance actions. Standing preamble: (1) Zod parse,
// (2) a permission check before any service call.
//
// Self check-in/out is `staff.self` and the service resolves the
// caller's own staff row from ctx.userId — the key is not a window
// onto anyone else's attendance. Marking or correcting someone else
// is `staff.attendance` (the receptionist holds it; the coach does
// not).

export async function selfCheckInAction(raw: unknown): Promise<CheckInResult> {
  const parsed = checkInInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid check-in.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return checkIn(ctx, parsed.data);
}

export async function selfCheckOutAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return checkOut(ctx);
}

export async function correctStaffAttendanceAction(
  raw: unknown,
): Promise<AttendanceResult> {
  const parsed = correctionInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid correction.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.attendance");
  return correctAttendance(ctx, parsed.data);
}

export async function listStaffAttendanceDayAction(
  raw: unknown,
): Promise<StaffAttendanceDayRow[]> {
  const parsed = dayInput.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.attendance");
  return listStaffAttendanceDay(ctx, parsed.data);
}

export async function getMyAttendanceAction(
  raw: unknown,
): Promise<MyAttendanceRow | null> {
  const parsed = myAttendanceInput.safeParse(raw);
  if (!parsed.success) return null;
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return getMyAttendance(ctx, parsed.data);
}
