// THE LEAVE DECISION — the owner path and the contained path.
//
// ONE entry point, ONE recorded-day rule, ONE write. The caller's own
// membership decides which checks run; the write is the same for both
// paths, so the two cannot drift apart.
//
// EVERY REFUSAL IS A THROWN, TYPED ERROR.
//
// `withTenant` is `db.transaction(async (tx) => { … return fn(tx); })`
// (db/tenant.ts:20-27): drizzle COMMITS when the callback RESOLVES. A
// service that RETURNS `{ ok: false }` after it has written inside the
// transaction COMMITS that write and then reports a refusal — the trap
// the independent review recorded as I-6. Refusing by throwing removes
// the trap structurally: the transaction ROLLS BACK, and the refusal is
// mapped to a result object OUTSIDE the transaction, so the action
// layer still receives a result rather than an exception.
//
// THE LOCK ORDER, in this module:
//
//   leave_requests(R) → staff(S) → shifts(X) → attendance(A)
//
// The staff row is the per-staff roster mutex
// (lib/services/staff-roster-lock.ts). It is taken BEFORE the affected
// set is read, so a shift inserted concurrently is either already
// visible to the containment check or is ordered after the decision —
// never silently missed.
//
// The mutex is a `FOR NO KEY UPDATE` lock, not a `FOR UPDATE` lock, and
// that is deliberate: the attendance-correction writer takes the
// attendance row first and then a foreign-key `FOR KEY SHARE` on the
// STAFF row, and `FOR KEY SHARE` does not conflict with
// `FOR NO KEY UPDATE`. See the packet's LOCK-ORDER.md §3.
//
// THE SEAMS. The rules that refuse a decision live in
// ./leave-decision-refusals; the write lives in ./leave-decision-write;
// the affected rows and the recorded-day evidence live in
// ./leave-decision-evidence; the caller's authority lives in
// ./leave-decision-scope.

import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { leaveRequests } from "@/db/schema/leave";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
import { lockStaffForRoster } from "@/lib/services/staff-roster-lock";
import {
  affectedShiftsInRange,
  lockAffectedShifts,
} from "@/lib/services/leave-decision-evidence";
import {
  containedRefusal,
  recordedDayBlock,
} from "@/lib/services/leave-decision-refusals";
import {
  isScopedCaller,
  resolveLeaveCaller,
} from "@/lib/services/leave-decision-scope";
import {
  writeDecision,
  type LeaveAuditWriter,
  type LeaveDecisionResult,
} from "@/lib/services/leave-decision-write";
import type { ActionCtx } from "@/lib/auth/context";
import type { StaffId } from "@/lib/ids";

export type { LeaveDecisionResult };

// THE REFUSAL.
//
// A refusal is a normal answer, not an exception: it is caught and
// mapped to `{ ok: false, error }` outside the transaction. Inside the
// transaction it is an exception, because that is the only thing that
// rolls the transaction back.
export class LeaveDecisionRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveDecisionRefusal";
  }
}

function refuse(message: string): never {
  throw new LeaveDecisionRefusal(message);
}

// THE DECISION.
export async function decideLeaveRequest(
  ctx: ActionCtx,
  input: { requestId: string; note?: string | null },
  decision: "approved" | "rejected",
  writeAuditRow: LeaveAuditWriter,
): Promise<LeaveDecisionResult> {
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      // ── 1. WHO IS DECIDING ────────────────────────────────────────
      //
      // The caller's OWN membership decides the branch; a ctx's role
      // claim is never trusted for this. The scope comes from the ONE
      // canonical resolver (lib/services/leave-decision-scope.ts).
      const caller = await resolveLeaveCaller(tx, ctx);
      if (caller.kind === "refused") refuse(caller.error);
      // A leave decision is a human act: an identity-free caller
      // decides nothing. The house precedent is lib/services/shifts.ts.
      if (caller.kind === "system" || caller.kind === "identity-free") {
        refuse("Not authenticated.");
      }

      // An owner/admin is a user with a membership, not necessarily a
      // staff row. When the decider has no staff record, `decided_by`
      // stays null and the audit row's actor_id carries who decided;
      // `decided_at` is always recorded.
      const decider: StaffId | null = await ownStaffIdInTx(tx, ctx);

      // ── 2. THE REQUEST, LOCKED ────────────────────────────────────
      //
      // The request row is the first lock in the order
      // (leave_requests → staff → shifts → attendance). It also
      // serialises two decisions on the same request.
      const [request] = await tx
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.id, input.requestId),
            eq(leaveRequests.tenantId, ctx.tenantId),
          ),
        )
        .for("update");
      if (!request) refuse("Leave request not found.");
      if (request.status !== "pending") {
        refuse("This request has already been decided.");
      }

      // ── 3. THE PER-STAFF ROSTER MUTEX ─────────────────────────────
      //
      // The staff row is locked BEFORE the affected set is read. Every
      // writer that can create or change a rostered shift for this
      // person takes the SAME lock first, so a concurrent insert is
      // either already committed (and therefore visible to the read
      // below) or is ordered after this transaction. There is no
      // window in between.
      const lockedStaff = await lockStaffForRoster(
        tx,
        ctx.tenantId,
        request.staffId,
      );
      if (!lockedStaff) refuse("That staff member no longer exists.");

      // ── 4. THE AFFECTED ROWS (unlocked) AND THE CHEAP CHECKS ─────
      const affected = await affectedShiftsInRange(
        tx,
        ctx.tenantId,
        request.staffId,
        request.fromDate,
        request.toDate,
      );

      if (isScopedCaller(caller)) {
        const refusal = containedRefusal(caller, affected);
        if (refusal) refuse(refusal);
      }

      // ── 5. THE AFFECTED ROWS, LOCKED ──────────────────────────────
      const lockedShifts = await lockAffectedShifts(
        tx,
        ctx.tenantId,
        request.staffId,
        request.fromDate,
        request.toDate,
      );

      if (isScopedCaller(caller)) {
        // The containment re-check over the rows this transaction
        // HOLDS. With the per-staff roster mutex in place the set
        // cannot GROW between the two reads — a concurrent insert is
        // ordered after this transaction — so this check is a cheap
        // invariant check, not a barrier. It is NOT a barrier on its
        // own: `SELECT … FOR UPDATE` takes no predicate lock.
        const refusal = containedRefusal(caller, lockedShifts);
        if (refusal) refuse(refusal);
      }

      // ── 6. THE RECORDED-DAY RULE — OWNER AND MANAGER ALIKE ───────
      //
      // A leave APPROVAL is refused when the request overlaps
      // attendance that is already recorded as worked or absent. A
      // REJECTION IS NOT BLOCKED: a rejection writes no shift, so it
      // cannot contradict a recorded day.
      let resolvedShiftIds: string[] = [];
      if (decision === "approved") {
        const block = await recordedDayBlock(
          tx,
          ctx.tenantId,
          request.staffId,
          lockedShifts,
        );
        if (block.error) refuse(block.error);
        resolvedShiftIds = block.resolvedShiftIds;
      }

      // ── 7. THE WRITE ──────────────────────────────────────────────
      //
      // The write is the LAST thing the transaction does. Every refusal
      // is raised BEFORE it.
      return await writeDecision(
        tx,
        ctx,
        request,
        input,
        decision,
        decider,
        caller,
        writeAuditRow,
        resolvedShiftIds,
      );
    });
  } catch (error) {
    if (error instanceof LeaveDecisionRefusal) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
