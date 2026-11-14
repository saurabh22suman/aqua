// THE RULES THAT REFUSE A DECISION.
//
// One place per rule, so the cheap pre-check and the post-lock
// re-check cannot drift apart, and so the owner and the manager cannot
// drift apart.
//
// Both helpers return the refusal MESSAGE (or null when nothing
// blocks). The caller raises it: a refusal is a THROWN, typed error
// inside the decision's transaction, so the transaction rolls back —
// see lib/services/leave-decision.ts.
//
// A refusal writes NOTHING: no decision row, no shift change, no audit
// row.

import type { TenantTx } from "@/db/tenant";
import type { StaffId, TenantId } from "@/lib/ids";
import {
  LEAVE_DECISION_EVIDENCE,
  linkedAttendanceBlocks,
  lockLinkedAttendance,
  uncoveredAffectedFacilities,
  type AffectedShift,
} from "@/lib/services/leave-decision-evidence";
import { hasCurrentOwnerResolution } from "@/lib/services/staff-attendance-owner-resolution";
import type { ScopedCaller } from "@/lib/services/leave-decision-scope";

// The message both roles get when a recorded day blocks the approval.
//
// It names the RESOLUTION, not the role: the owner is blocked by it
// too, so a message that said "an owner must resolve this" would be
// wrong for the owner and misleading for the manager.
export const RECORDED_DAY_MESSAGE =
  "This leave request overlaps attendance already recorded as worked or absent. Resolve the attendance record before this leave can be approved.";

// THE CONTAINED BRANCH'S REFUSALS.
//
//   1. the caller must hold at least one facility — an empty selection
//      is a blank appointment, not "every facility";
//   2. a request with NO scheduled shift is OWNER-ONLY — for the
//      approval AND the rejection;
//   3. every facility the request AFFECTS must be one the caller
//      holds. THE FOOTPRINT IS THE AFFECTED SHIFT ROWS' FACILITIES —
//      the person's other facilities are not part of it.
//
// Rule 2 is settled rule R3 applied to every SCOPED decider: "only an
// owner may decide it". It is a DERIVED application for the legacy
// O-08 branch — the human may narrow it to the manager branch alone.
//
// THERE IS NO FOURTH RULE, AND THAT IS DELIBERATE.
//
// The decided person does NOT have to be attached to one of the
// caller's facilities. The human's settled rule is that the decision's
// footprint is the request's AFFECTED SHIFT ROWS' FACILITIES: a person
// who also works at a facility outside the caller's scope does not
// widen the decision, and the caller's ability to decide is not
// narrowed by it either. A rule that required the attachment would
// make the decision's footprint the person's assignment instead of the
// request's affected shifts, and no settled rule asks for that.
//
// It is a pure function: it reads the already-read affected set and
// the caller's own scope, and it touches no row.
export function containedRefusal(
  caller: ScopedCaller,
  affected: readonly AffectedShift[],
): string | null {
  const facilityIds = caller.access.locationIds;
  if (facilityIds.length === 0) {
    return "You have no selected facility, so you cannot decide a leave request.";
  }
  if (affected.length === 0) {
    return "This leave request has no scheduled shifts. Only an owner may decide it.";
  }
  const outside = uncoveredAffectedFacilities(facilityIds, affected);
  if (outside.length > 0) {
    return "This leave request affects a facility outside your locations. Ask the owner, or someone who holds every affected facility, to decide it.";
  }
  return null;
}

// THE RECORDED-DAY RULE, as ONE helper.
//
// The owner and the manager cannot drift apart: both call this. It
// returns the refusal message, or null when nothing blocks.
//
// Two halves:
//   • an affected shift row whose status is `worked` or `absent`; and
//   • a LINKED staff_attendance row for one of those affected shifts
//     whose status is `present` or `absent`.
//
// The attendance half LOCKS EVERY LINKED ROW FIRST and then asks which
// of them block. The lock is what makes the answer stable until the
// write commits; the status test is a pure function of the locked rows.
export async function recordedDayBlock(
  tx: TenantTx,
  tenantId: TenantId,
  staffId: StaffId,
  affected: readonly AffectedShift[],
): Promise<{ error: string | null; resolvedShiftIds: string[]; attendanceWorkDates: string[] }> {
  // Always lock every linked record, including nonblocking ones, before
  // deciding; a later correction cannot overtake this transaction.
  const linked = await lockLinkedAttendance(tx, tenantId, staffId, affected.map((row) => row.id));
  const hasBlockingAttendance = linkedAttendanceBlocks(linked);
  const resolvedShiftIds: string[] = [];
  const unresolvedDates = new Set(linked.filter((item) =>
    (LEAVE_DECISION_EVIDENCE.blockingAttendanceStatuses as readonly string[]).includes(item.status),
  ).map((item) => item.row.workDate));
  let unresolvedShift = false;
  for (const shift of affected) {
    if (!(LEAVE_DECISION_EVIDENCE.blockingShiftStatuses as readonly string[]).includes(shift.status)) continue;
    // Multiple attendance rows can name one shift. A nonblocking row
    // must not hide another row's current owner-resolution proof.
    let resolved = false;
    for (const evidence of linked) {
      if (evidence.shiftId === shift.id && await hasCurrentOwnerResolution(tx, evidence.row)) {
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      unresolvedShift = true;
      for (const item of linked) if (item.shiftId === shift.id) unresolvedDates.add(item.row.workDate);
    } else {
      resolvedShiftIds.push(shift.id);
    }
  }
  if (hasBlockingAttendance || unresolvedShift) {
    return { error: RECORDED_DAY_MESSAGE, resolvedShiftIds: [], attendanceWorkDates: [...unresolvedDates].sort() };
  }
  return { error: null, resolvedShiftIds, attendanceWorkDates: [] };
}
