// THE AFFECTED SET AND THE RECORDED-DAY EVIDENCE.
//
// Two sets, stated once:
//
//   • the AFFECTED set — every shift row for the decided staff member
//     inside the request's date range, whatever its status. This is the
//     decision's FOOTPRINT (the settled rule R1): the request's
//     affected facilities, and nothing else. The decided person's
//     OTHER facilities are not part of it.
//
//   • the EVIDENCE set — the attendance rows that say a day was
//     already recorded as worked or absent.
//
// The BLOCKING set is a SUBSET of the LOCKED set, and it always will
// be: the locked set is EVERY linked attendance row, whatever its
// status, because a row that is `half_day` today can be corrected to
// `present` by a concurrent writer, and that correction's UPDATE
// touches no key column, so it takes no foreign-key lock on the shift
// row. Only the attendance-row lock stops it. Narrowing the BLOCKING
// set therefore never narrows the LOCKED set.
//
// `half_day` is NOT in the blocking attendance set. The human's
// sentence names worked / present / absent; widening it is a product
// decision, not one this module makes.
//
// THIS MODULE QUERIES THE `shifts` TABLE, WHICH CARRIES A LOCATION
// COLUMN. The location-scope scanner's table list is
// `members | batches | sessions | attendance`
// (scripts/lib/location-scope-scan.ts:18-19) and does not include
// `shifts`, so this module is not scanned today. Widening that list is
// a separate change with its own consequences (it would newly flag
// lib/services/staff-attendance.ts, lib/services/staff-attendance-list.ts,
// lib/services/staff-attendance-correction.ts and
// lib/services/owner-people-reports.ts, none of which consults the
// location-access helper). It is recorded as an open item, not fixed
// here.

import { and, between, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { TenantTx } from "@/db/tenant";
import { shifts } from "@/db/schema/shifts";
import { staffAttendance, type StaffAttendance } from "@/db/schema/staff-attendance";
import type { StaffId, TenantId } from "@/lib/ids";
import { SHIFT_LOCK_ORDER } from "./staff-roster-lock";

// THE TWO BLOCKING SETS, STATED ONCE.
//
//   • the SHIFT half: an affected shift row whose status is `worked`
//     or `absent`;
//   • the ATTENDANCE half: a LINKED `staff_attendance` row for one of
//     the affected shifts whose status is `present` or `absent`.
//
// The block applies to the APPROVAL of the owner and of the manager
// alike. A rejection is never blocked: a rejection writes no shift.
export const LEAVE_DECISION_EVIDENCE = {
  blockingShiftStatuses: ["worked", "absent"],
  blockingAttendanceStatuses: ["present", "absent"],
} as const;

// One shift row the request affects.
export type AffectedShift = {
  id: string;
  locationId: string;
  status: string;
};

// One LINKED attendance row. `shiftId` is NULLABLE
// (db/schema/staff-attendance.ts:39) and a row with no shift is not
// evidence of anything, so only linked rows are ever returned here.
export type LinkedAttendance = {
  id: string;
  shiftId: string | null;
  status: string;
  row: StaffAttendance;
};

// THE AFFECTED ROWS.
//
// Every shift row for this staff member inside the request's date
// range, whatever its status. A `worked` or `absent` row counts too —
// the conservative rule.
//
// The ORDER is the shared shift order (shift_date, start_at, id): a
// total order over the rows, so two writers that take these rows take
// them the same way.
export async function affectedShiftsInRange(
  tx: TenantTx,
  tenantId: TenantId,
  staffId: StaffId,
  fromDate: string,
  toDate: string,
): Promise<AffectedShift[]> {
  return tx
    .select({
      id: shifts.id,
      locationId: shifts.locationId,
      status: shifts.status,
    })
    .from(shifts)
    .where(
      and(
        eq(shifts.tenantId, tenantId),
        eq(shifts.staffId, staffId),
        between(shifts.shiftDate, fromDate, toDate),
      ),
    )
    .orderBy(...SHIFT_LOCK_ORDER);
}

// The same rows, LOCKED.
//
// `FOR UPDATE OF shifts` is the decision's mutex against the shift
// writers that take a shift row: `deleteShift` takes the shift row
// `FOR UPDATE` (lib/services/shifts.ts), and PostgreSQL's foreign-key
// check takes a `FOR KEY SHARE` lock on the referenced row, which
// CONFLICTS with `FOR UPDATE`. A decision that holds the affected rows
// therefore cannot be overtaken by a check-in that lands on one of
// them.
//
// It does NOT exclude a row INSERTED after the statement started: see
// lib/services/staff-roster-lock.ts for the mutex that does.
export async function lockAffectedShifts(
  tx: TenantTx,
  tenantId: TenantId,
  staffId: StaffId,
  fromDate: string,
  toDate: string,
): Promise<AffectedShift[]> {
  return tx
    .select({
      id: shifts.id,
      locationId: shifts.locationId,
      status: shifts.status,
    })
    .from(shifts)
    .where(
      and(
        eq(shifts.tenantId, tenantId),
        eq(shifts.staffId, staffId),
        between(shifts.shiftDate, fromDate, toDate),
      ),
    )
    .orderBy(...SHIFT_LOCK_ORDER)
    .for("update", { of: shifts });
}

// LOCK every LINKED attendance row for the affected shifts.
//
// LINKED means: the record names one of the affected shifts
// (`staff_attendance.shift_id` is NULLABLE — db/schema/staff-attendance.ts:39
// — and a record with no shift is not evidence of anything) and the
// the record belongs to the same staff member. A different work date is
// still linked evidence and cannot silently disappear from the lock set.
//
// THERE IS NO STATUS FILTER IN THE SQL, AND NO `LIMIT 1`. That is the
// whole point of this function:
//
//   • `checkIn` INSERTS a row and names `shift_id`, so PostgreSQL's
//     foreign-key check takes `FOR KEY SHARE` on the referenced shift
//     row — which CONFLICTS with the decision's `FOR UPDATE` on that
//     row. The INSERT path is therefore already serialised against the
//     decision by the shift lock.
//   • `correctAttendance` UPDATES an existing row and does NOT set
//     `shift_id` (lib/services/staff-attendance-correction.ts), so
//     PostgreSQL re-checks NO foreign key on the shift row. The ONLY
//     thing that serialises that correction against the decision is
//     the attendance-row lock.
//
// `FOR UPDATE OF staff_attendance` locks the attendance rows and NOT
// the joined shift rows. The shift rows are already locked by
// `lockAffectedShifts`, and a bare `FOR UPDATE` over the join would
// widen the lock to the whole joined set.
export async function lockLinkedAttendance(
  tx: TenantTx,
  tenantId: TenantId,
  staffId: StaffId,
  affectedShiftIds: readonly string[],
): Promise<LinkedAttendance[]> {
  if (affectedShiftIds.length === 0) return [];
  return tx
    .select({
      id: staffAttendance.id,
      shiftId: staffAttendance.shiftId,
      status: staffAttendance.status,
      row: staffAttendance,
    })
    .from(staffAttendance)
    .innerJoin(
      shifts,
      and(
        eq(shifts.id, staffAttendance.shiftId),
        eq(shifts.tenantId, tenantId),
      ),
    )
    .where(
      and(
        eq(staffAttendance.tenantId, tenantId),
        eq(staffAttendance.staffId, staffId),
        inArray(staffAttendance.shiftId, [...affectedShiftIds]),
      ),
    )
    .for("update", { of: staffAttendance });
}

// Does one of the LOCKED rows block the approval?
//
// The status test happens HERE, in JS, over the rows the transaction
// already holds. It is not in the SQL, because a status filter in the
// SQL would leave the non-blocking rows UNLOCKED.
export function linkedAttendanceBlocks(
  rows: readonly LinkedAttendance[],
): boolean {
  const blocking =
    LEAVE_DECISION_EVIDENCE.blockingAttendanceStatuses as readonly string[];
  return rows.some((row) => blocking.includes(row.status));
}

// THE FACILITIES THE REQUEST AFFECTS THAT THE CALLER'S SCOPE DOES NOT
// COVER.
//
// THE FOOTPRINT IS THE AFFECTED SHIFT ROWS' FACILITIES — and nothing
// else. The decided person's own `staff_locations` rows are NOT a
// dimension of the decision: a person who also works at C does not
// make an A-only request wider.
//
// A shift carries NO nullable location (`shifts.location_id` is NOT
// NULL), so every affected row names exactly one facility and the
// comparison is total.
export function uncoveredAffectedFacilities(
  facilityIds: readonly string[],
  affected: readonly AffectedShift[],
): string[] {
  const selected = new Set(facilityIds);
  const outside = new Set<string>();
  for (const row of affected) {
    if (!selected.has(row.locationId)) outside.add(row.locationId);
  }
  return [...outside];
}

// A facility filter for a scoped caller.
//
// An empty selection is a refusal, never "every facility": the empty
// case answers `false`, never an empty IN list. A NULL-location row
// (a whole-business row) is wider than "these facilities", so it is
// excluded for a scoped caller — and a shift carries NO nullable
// location (`shifts.location_id` is NOT NULL), so this is the whole
// answer for the roster write.
export function facilityFilter(
  facilityIds: readonly string[],
  column: PgColumn,
): SQL {
  if (facilityIds.length === 0) return sql`false`;
  return inArray(column, [...facilityIds]);
}
