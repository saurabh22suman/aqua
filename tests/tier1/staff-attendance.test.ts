import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asStaffId, asTenantId, asUserId } from "@/lib/ids";
import { formatWallTime24hIST, todayInZone } from "@/lib/time/tz";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// V-24 — staff attendance. Written before
// lib/services/staff-attendance.ts exists: the first run is
// deliberately red.
//
// The done-when is pinned behaviourally: a manual correction records
// WHO made it (`marked_by` = the correcting staff member) and WHY
// (`note`, non-empty), and both land in the same audit row as
// before/after. A correction without a reason is refused. Late minutes
// are measured against the day's first shift and stored.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const loc = uuidv7();
const coachUser = asUserId(uuidv7());
const coachPerson = uuidv7();
const coachStaff = asStaffId(uuidv7());
const deskUser = asUserId(uuidv7());
const deskPerson = uuidv7();
const deskStaff = asStaffId(uuidv7());
const coachCtx = { tenantId: tenant, userId: coachUser, requestId: uuidv7() };
const deskCtx = { tenantId: tenant, userId: deskUser, requestId: uuidv7() };

const TODAY = todayInZone(TZ);

let attendance: typeof import("@/lib/services/staff-attendance");
let shifts: typeof import("@/lib/services/shifts");

beforeAll(async () => {
  attendance = await import("@/lib/services/staff-attendance");
  shifts = await import("@/lib/services/shifts");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Attendance Flow', 'active', $3)",
    [tenant, `v24-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main Site', true)",
    [loc, tenant],
  );
  await admin.query(
    "insert into users (id, phone) values ($1, $2), ($3, $4)",
    [
      coachUser,
      `+9196${String(Date.now()).slice(-8)}`,
      deskUser,
      `+9197${String(Date.now()).slice(-8)}`,
    ],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $2, 'Coach Attendance'), ($3, $2, 'Desk Attendance')`,
    [coachPerson, tenant, deskPerson],
  );
  await admin.query(
    `insert into staff (id, tenant_id, person_id, user_id, staff_type) values
       ($1, $2, $3, $4, 'coach'), ($5, $2, $6, $7, 'receptionist')`,
    [coachStaff, tenant, coachPerson, coachUser, deskStaff, deskPerson, deskUser],
  );
}, 60_000);

afterAll(async () => {
  await admin.query("delete from staff_attendance where tenant_id = $1", [tenant]);
  await admin.query("delete from shifts where tenant_id = $1", [tenant]);
  await admin.query("delete from staff where tenant_id = $1", [tenant]);
  await admin.query("delete from persons where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await deleteAuditRowsForTenant(admin, tenant);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

async function auditCount(action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenant, action],
  );
  return Number(rows[0]!.count);
}

describe("V-24 staff attendance", () => {
  it("checks in with no shift — present, zero late minutes, self_app", async () => {
    const result = await attendance.checkIn(coachCtx, { method: "self_app" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("present");
    expect(result.lateMinutes).toBe(0);

    const { rows } = await admin.query<{
      method: string;
      marked_by: string | null;
      checked_in_at: string | null;
      shift_id: string | null;
    }>(
      "select method, marked_by, checked_in_at, shift_id from staff_attendance where id = $1",
      [result.attendanceId],
    );
    expect(rows[0]!.method).toBe("self_app");
    expect(rows[0]!.marked_by).toBeNull();
    expect(rows[0]!.checked_in_at).not.toBeNull();
    expect(rows[0]!.shift_id).toBeNull();
    expect(await auditCount("staff.attendance.check_in")).toBe(1);
  });

  it("refuses a second check-in on the same day", async () => {
    const again = await attendance.checkIn(coachCtx, { method: "self_app" });
    expect(again.ok).toBe(false);
  });

  it("checks out, and refuses a check-out without a check-in", async () => {
    const out = await attendance.checkOut(coachCtx);
    expect(out.ok).toBe(true);

    const { rows } = await admin.query<{ checked_out_at: string | null }>(
      "select checked_out_at from staff_attendance where tenant_id = $1 and staff_id = $2 and work_date = $3",
      [tenant, coachStaff, TODAY],
    );
    expect(rows[0]!.checked_out_at).not.toBeNull();
    expect(await auditCount("staff.attendance.check_out")).toBe(1);

    const deskOut = await attendance.checkOut(deskCtx);
    expect(deskOut.ok).toBe(false);
  });

  it("measures late minutes against the day's first shift and stores them", async () => {
    // Desk staff: no attendance yet today. Create a shift that started
    // an hour ago and ends in an hour, then check in — late minutes
    // must be ~60, measured against that shift.
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    const shift = await shifts.createShift(deskCtx, {
      staffId: deskStaff,
      locationId: loc,
      shiftDate: TODAY,
      startTime: formatWallTime24hIST(startedAt),
      endTime: formatWallTime24hIST(new Date(Date.now() + 60 * 60 * 1000)),
    });
    expect(shift.ok).toBe(true);
    if (!shift.ok) return;

    const result = await attendance.checkIn(deskCtx, {
      method: "self_app",
      shiftId: shift.shiftId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lateMinutes).toBeGreaterThanOrEqual(59);
    expect(result.lateMinutes).toBeLessThanOrEqual(61);

    const { rows } = await admin.query<{ shift_id: string; late_minutes: number }>(
      "select shift_id, late_minutes from staff_attendance where id = $1",
      [result.attendanceId],
    );
    expect(rows[0]!.shift_id).toBe(shift.shiftId);
    expect(rows[0]!.late_minutes).toBeGreaterThanOrEqual(59);
  });

  it("records who corrected and why — and refuses a correction without a reason", async () => {
    const refused = await attendance.correctAttendance(deskCtx, {
      staffId: coachStaff,
      workDate: TODAY,
      status: "half_day",
      note: "   ",
    });
    expect(refused.ok).toBe(false);

    const corrected = await attendance.correctAttendance(deskCtx, {
      staffId: coachStaff,
      workDate: TODAY,
      status: "half_day",
      note: "Left early for a doctor's appointment",
    });
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;

    const { rows } = await admin.query<{
      method: string;
      marked_by: string;
      note: string;
      status: string;
    }>(
      "select method, marked_by, note, status from staff_attendance where id = $1",
      [corrected.attendanceId],
    );
    expect(rows[0]!.method).toBe("manual");
    expect(rows[0]!.marked_by).toBe(deskStaff);
    expect(rows[0]!.note).toBe("Left early for a doctor's appointment");
    expect(rows[0]!.status).toBe("half_day");

    const audit = await admin.query<{ before: unknown; after: unknown }>(
      `select before, after from audit_log
        where tenant_id = $1 and action = 'staff.attendance.correct'
        order by id desc limit 1`,
      [tenant],
    );
    const after = audit.rows[0]!.after as { note?: string; markedBy?: string };
    expect(after.note).toBe("Left early for a doctor's appointment");
    expect(after.markedBy).toBe(deskStaff);
    expect(await auditCount("staff.attendance.correct")).toBe(1);
  });

  it("lists the day's staff attendance for the desk", async () => {
    const rows = await attendance.listStaffAttendanceDay(deskCtx, {
      date: TODAY,
      locationId: loc,
    });
    const byStaff = new Map(rows.map((r) => [r.staffId, r]));
    expect(byStaff.get(coachStaff)?.status).toBe("half_day");
    expect(byStaff.get(coachStaff)?.note).toBe(
      "Left early for a doctor's appointment",
    );
    expect(byStaff.get(deskStaff)?.status).toBe("present");
    expect(byStaff.get(deskStaff)?.lateMinutes).toBeGreaterThanOrEqual(59);
  });

  it("returns the caller's own attendance for the Me tab", async () => {
    const mine = await attendance.getMyAttendance(coachCtx, { date: TODAY });
    expect(mine?.status).toBe("half_day");
    const none = await attendance.getMyAttendance(deskCtx, {
      date: "2000-01-01",
    });
    expect(none).toBeNull();
  });
});
