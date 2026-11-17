import { and, asc, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import {
  staffAttendance,
  type StaffAttendanceMethod,
  type StaffAttendanceStatus,
} from "@/db/schema/staff-attendance";
import { shifts } from "@/db/schema/shifts";
import { staff } from "@/db/schema/staff";
import { staffLocations } from "@/db/schema/staff-locations";
import { persons } from "@/db/schema/people";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
import {
  locationPredicate,
  locationVisible,
} from "@/lib/services/location-access";
import {
  resolveStaffScope,
  staffScopePredicate,
  type StaffScopeCtx,
} from "@/lib/services/staff-scope";
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
  /**
   * How to read a null `status`:
   *
   *   "full"    — the facility-proof filter was NOT applied. Null means
   *               "not marked" in the set this caller may see.
   *   "limited" — the facility-proof filter WAS applied. Null means
   *               UNKNOWN: no record, or a record whose evidence is not
   *               visible here. The read does not distinguish them.
   *
   * Optional for backward compatibility: an omitted value is treated as
   * "full" by the board. The value is derived from the caller's SCOPE,
   * never from whether a particular row was withheld.
   */
  attendanceVisibility?: "full" | "limited";
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
  ctx: StaffScopeCtx,
  raw: unknown,
): Promise<StaffAttendanceDayRow[]> {
  const parsed = dayInput.safeParse(raw);
  if (!parsed.success) return [];
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    // The caller's facilities: their own ACTIVE membership's for a
    // facility-scoped caller; the switch's answer for every other role;
    // unrestricted for the owner, an all-locations caller or an explicit
    // system actor.
    const scope = await resolveStaffScope(tx, ctx);

    // A facility the caller may not see is not a filter they can use. The
    // board is empty — not another facility's data, and not a silently
    // widened board either.
    if (input.locationId && !locationVisible(scope, input.locationId)) {
      return [];
    }
    const selectedLocationId = input.locationId ?? null;

    // The board's row set is the staff list. The staff row has no location
    // column; staff_locations is the facility link, and EXISTS keeps a
    // multi-facility staff member to ONE row.
    const staffConditions = [
      eq(staff.tenantId, ctx.tenantId),
      isNull(staff.deletedAt),
    ];
    const predicate = staffScopePredicate(tx, staff.id, scope, ctx.tenantId);
    if (predicate) staffConditions.push(predicate);

    // FACILITY-SCOPED MANAGER BRANCH ONLY: an explicit selected facility
    // narrows the row set to staff who work at THAT facility. The caller's
    // wider A+B scope is not the answer to "show me Facility A". The tenant
    // is named in the subquery as defence in depth. Owner and legacy
    // callers are deliberately not narrowed here (HANDOFF.md assumption 1).
    if (
      !scope.unrestricted &&
      !scope.includeUnlocated &&
      selectedLocationId !== null
    ) {
      staffConditions.push(
        exists(
          tx
            .select({ one: sql`1` })
            .from(staffLocations)
            .where(
              and(
                eq(staffLocations.tenantId, ctx.tenantId),
                eq(staffLocations.staffId, staff.id),
                eq(staffLocations.locationId, selectedLocationId),
              ),
            ),
        ),
      );
    }

    const staffRows = await tx
      .select({
        id: staff.id,
        name: persons.fullName,
        staffType: staff.staffType,
      })
      .from(staff)
      .innerJoin(persons, eq(persons.id, staff.personId))
      .where(and(...staffConditions))
      .orderBy(asc(persons.fullName));

    // A denied or empty scope reaches no staff, so it reads nothing. This is
    // also what keeps an empty IN list from degrading into "all".
    const staffIds = staffRows.map((row) => row.id);
    if (staffIds.length === 0) return [];

    // ── Attendance ────────────────────────────────────────────────────
    //
    // Tenant and work date are the base. A restricted caller additionally
    // reads only the staff rows on THIS board.
    const attendanceConditions = [
      eq(staffAttendance.tenantId, ctx.tenantId),
      eq(staffAttendance.workDate, input.date),
    ];
    if (!scope.unrestricted) {
      attendanceConditions.push(inArray(staffAttendance.staffId, staffIds));

      if (!scope.includeUnlocated) {
        // Facility-scoped caller: the record must PROVE its facility through
        // its own shift_id. All links must hold:
        //   • same tenant (the composite FK also guarantees it; explicit for
        //     defence in depth);
        //   • SAME staff member (the FK is composite on (shift_id, tenant_id),
        //     not on staff, so this MUST be checked);
        //   • SAME work date (check-in accepts a client-supplied shift id
        //     without re-checking the date);
        //   • a location the caller may see;
        //   • when the board is filtered to one facility, THAT facility —
        //     not merely another facility in the caller's wider scope.
        // A null shift_id, a missing/foreign shift, a wrong-staff link, a
        // wrong-date link, an out-of-scope location or a different in-scope
        // facility (on an explicit filter) all fail the EXISTS. The record
        // then never reaches `byStaff`, so the row reports unknown — never
        // absence — and staff_locations is not consulted.
        const recordedShiftLocation = locationPredicate(shifts.locationId, scope);
        attendanceConditions.push(
          exists(
            tx
              .select({ one: sql`1` })
              .from(shifts)
              .where(
                and(
                  eq(shifts.id, staffAttendance.shiftId),
                  eq(shifts.tenantId, ctx.tenantId),
                  eq(shifts.staffId, staffAttendance.staffId),
                  eq(shifts.shiftDate, staffAttendance.workDate),
                  ...(selectedLocationId !== null
                    ? [eq(shifts.locationId, selectedLocationId)]
                    : []),
                  recordedShiftLocation,
                ),
              ),
          ),
        );
      }
    }
    const attendanceRows = await tx
      .select()
      .from(staffAttendance)
      .where(and(...attendanceConditions));
    const byStaff = new Map(attendanceRows.map((r) => [r.staffId, r]));

    // ── Shifts ────────────────────────────────────────────────────────
    //
    // The shift columns are location-bearing. A restricted caller sees only
    // shifts at their own facilities, for the staff rows on this board, so a
    // multi-facility coach's out-of-scope shift cannot enter the first-shift
    // map. locationPredicate adds NULL-location rows only for the legacy
    // branch (shifts.location_id is NOT NULL today; defensive).
    const shiftConditions = [
      eq(shifts.tenantId, ctx.tenantId),
      eq(shifts.shiftDate, input.date),
    ];
    if (!scope.unrestricted) {
      shiftConditions.push(inArray(shifts.staffId, staffIds));
      const shiftScope = locationPredicate(shifts.locationId, scope);
      if (shiftScope) shiftConditions.push(shiftScope);
    }
    if (selectedLocationId !== null) {
      shiftConditions.push(eq(shifts.locationId, selectedLocationId));
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

    // The board-mode flag, derived from the SCOPE once per response. Do not
    // make this per-row from the proof result: that would disclose that a
    // withheld record exists. The legacy includeUnlocated branch is "full"
    // because it does not apply the facility proof; a null status there
    // still means "not marked" in its record set.
    const attendanceVisibility: "full" | "limited" =
      !scope.unrestricted && !scope.includeUnlocated ? "limited" : "full";

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
        attendanceVisibility,
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
