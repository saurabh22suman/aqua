// The per-staff roster mutex.
//
// One lock, three takers: the leave decision, `createShift` and
// `deleteShift`. It is a row lock on the STAFF row — the parent that
// always exists for the person whose roster is being changed — and it
// is the same lock, on the same row, for the same class of race, that
// `requestLeave` already takes for the leave quota
// (lib/services/leave.ts:85-94). The house precedent is the argument
// for the shape; this module is the argument for the shared name.
//
// WHY A ROW LOCK AND NOT A RE-READ.
//
// `withTenant` opens `db.transaction` with no isolation option
// (db/tenant.ts:20-27), so the transaction runs at PostgreSQL's
// default READ COMMITTED: every statement takes a fresh snapshot, and
// `SELECT … FOR UPDATE` takes NO predicate lock — it does not exclude
// a row inserted after the statement started. A decision that only
// re-reads its affected set therefore cannot see a shift that commits
// after the last read, and "one more re-read at the end" is a
// DETECTION, not a BARRIER.
//
// The mutex replaces the window with an ORDER. For one staff member,
// a shift insert and a leave decision are totally ordered:
//
//   • the insert commits before the decision acquires the staff row →
//     the decision's affected-set read happens AFTER it acquired the
//     row, so it sees the new shift and the containment check refuses;
//   • the decision holds the staff row → the insert waits; after the
//     decision commits, createShift reads approved leave and refuses an
//     overlapping date before inserting or auditing a shift.
//
// This ordering applies to these service paths sharing the mutex. Direct
// SQL and other writers are outside that guarantee.
//
// WHY `FOR NO KEY UPDATE` AND NOT `FOR UPDATE`.
//
// The mutex must exclude the OTHER ROSTER WRITERS, and only those. It
// must NOT exclude a FOREIGN-KEY CHECK, because a foreign-key check is
// not a roster writer:
//
//   • `correctAttendance`'s UPDATE path locks the attendance row
//     `FOR UPDATE` (lib/services/staff-attendance-correction.ts:185-195)
//     and then sets `marked_by`; because `marked_by` carries a foreign
//     key to `staff` (db/schema/staff-attendance.ts:77-86), PostgreSQL
//     re-checks that key and takes `FOR KEY SHARE` on the referenced
//     STAFF row. That writer therefore takes A → S.
//   • the decision takes S → X → A. With the mutex at `FOR UPDATE`,
//     `FOR KEY SHARE` CONFLICTS with `FOR UPDATE` (PostgreSQL's
//     row-level lock conflict matrix, Table 13.3), so a staff member
//     correcting their OWN attendance row while their OWN leave
//     request is being decided would deadlock: the decision holds S
//     and wants A, the correction holds A and wants S.
//   • `FOR NO KEY UPDATE` does NOT conflict with `FOR KEY SHARE`, and
//     DOES conflict with `FOR UPDATE`, `FOR SHARE` and with itself.
//     The three roster writers take the same `FOR NO KEY UPDATE` on
//     the same row, so they still exclude one another; a foreign-key
//     check on the staff row does not.
//
// WHAT THIS DOES NOT ORDER. The mutex is not a key lock: it does not
// stop a concurrent INSERT into `staff_attendance` for the same person
// through the `staff_id` foreign key (that check is a `FOR KEY SHARE`,
// which is compatible with the mutex). A check-in that names an
// AFFECTED shift is still ordered — the foreign key on `shift_id`
// takes `FOR KEY SHARE` on that shift row, which conflicts with the
// decision's own `FOR UPDATE` on the same row. A check-in that names
// NO affected shift writes an UNLINKED attendance row, which is not
// evidence under the linked-row rule the decision carries.
//
// The row is NOT filtered by `deleted_at`: a decision or a delete may
// still need to serialise against a soft-deleted staff member.
// `createShift` checks `deletedAt` itself and keeps its existing
// "Staff member not found." answer.
//
// Direct SQL, ops scripts, fixtures and any future writer that assigns
// an existing person to a different staff row are outside this
// module's service guarantee.

import { and, asc, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { shifts } from "@/db/schema/shifts";
import { staff } from "@/db/schema/staff";
import type { StaffId, TenantId } from "@/lib/ids";

// The one shift-row order the DECISION uses.
//
// The affected-set read and the affected-set lock both use it, so the
// decision's two reads take the same rows in the same order.
//
// It is NOT a repository-wide order. `publishRosterWeek`'s multi-row
// UPDATE has no ORDER BY (lib/services/roster.ts:134-138), so class X
// is not one total order across every writer that touches shift rows.
// See the packet's LOCK-ORDER.md §4 for what that does and does not
// mean.
export const SHIFT_LOCK_ORDER = [
  asc(shifts.shiftDate),
  asc(shifts.startAt),
  asc(shifts.id),
];

export type LockedStaffRow = {
  id: StaffId;
  deletedAt: Date | null;
};

// THE MUTEX.
//
// `FOR NO KEY UPDATE` on the staff row. The row is the parent of every
// shift for that person, so it is a stable lock target: it always
// exists, no roster writer deletes it, and it is the row the leave
// quota path already locks for the same reason.
//
// It is taken FIRST by every roster writer — before the affected rows
// are read, before the leave request is decided, before the shift row
// is locked — so that "whoever holds the staff row" is a single,
// answerable question.
export async function lockStaffForRoster(
  tx: TenantTx,
  tenantId: TenantId,
  staffId: StaffId,
): Promise<LockedStaffRow | null> {
  const [row] = await tx
    .select({ id: staff.id, deletedAt: staff.deletedAt })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.tenantId, tenantId)))
    .for("no key update");
  return row ?? null;
}
