// THE WRITE — the decision row, the rostered rows, the audit row.
//
// It is the LAST thing the decision's transaction does. Every refusal
// is raised BEFORE it, and every refusal is a thrown, typed error, so
// the transaction rolls back whatever happens (see
// lib/services/leave-decision.ts).
//
// The body is today's, with ONE addition: for a SCOPED caller the
// WHERE clause carries that caller's OWN facilities, using the SAME
// facility list the containment check used. The tenant-wide owner's
// whole-range marking is untouched.

import { and, between, eq, inArray, or } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { leaveRequests, type LeaveRequest } from "@/db/schema/leave";
import { shifts } from "@/db/schema/shifts";
import type { ActionCtx } from "@/lib/auth/context";
import type { StaffId } from "@/lib/ids";
import { facilityFilter } from "@/lib/services/leave-decision-evidence";
import { isScopedCaller, type LeaveCaller } from "@/lib/services/leave-decision-scope";

// What the decision produced, for the caller to write as the audit row.
//
// The ACTION NAME is deliberately NOT part of this payload: the file
// that owns the audit call site owns the action name too, so the
// literals "leave.approve" / "leave.reject" stay in
// lib/services/leave-approval.ts — the file the protected tier-1
// audit-coverage test names.
export type LeaveDecisionAudit = {
  entityId: string;
  before: { status: string };
  after: {
    status: string;
    decidedBy: StaffId | null;
    decidedAt: string;
    decisionNote: string | null;
    shiftsMarked: number;
    resolvedShiftIds: string[];
  };
};

// The audit writer the CALLER supplies.
//
// It is invoked INSIDE the decision's transaction, so the audit row and
// the decision row are still ONE atomic write — the repository rule
// ("every mutation writes its audit row in the same transaction") is
// not weakened by the split.
export type LeaveAuditWriter = (
  tx: TenantTx,
  audit: LeaveDecisionAudit,
) => Promise<void>;

export type LeaveDecisionResult =
  | { ok: true; shiftsMarked: number }
  | { ok: false; error: string };

export async function writeDecision(
  tx: TenantTx,
  ctx: ActionCtx,
  request: LeaveRequest,
  input: { note?: string | null },
  decision: "approved" | "rejected",
  decider: StaffId | null,
  caller: LeaveCaller,
  writeAuditRow: LeaveAuditWriter,
  resolvedShiftIds: readonly string[],
): Promise<LeaveDecisionResult> {
  const decidedAt = new Date();
  await tx
    .update(leaveRequests)
    .set({
      status: decision,
      decidedBy: decider,
      decidedAt,
      decisionNote: input.note ?? null,
      updatedBy: ctx.userId,
      updatedAt: decidedAt,
    })
    .where(
      and(
        eq(leaveRequests.id, request.id),
        eq(leaveRequests.tenantId, ctx.tenantId),
      ),
    );

  let shiftsMarked = 0;
  if (decision === "approved") {
    // THE SCOPED CALLER'S OWN FACILITIES, IN THE WRITE ITSELF.
    //
    // The containment checks ran over the rows read at step 4 and
    // locked at step 5. Carrying the caller's own facilities in the
    // WHERE clause means the write can never touch a shift at a
    // facility the caller does not hold, whatever the snapshot sees.
    //
    // The tenant-wide owner's branch is unchanged — it marks every
    // rostered row in the range, exactly as today.
    const conditions = [
      eq(shifts.tenantId, ctx.tenantId),
      eq(shifts.staffId, request.staffId),
      between(shifts.shiftDate, request.fromDate, request.toDate),
      resolvedShiftIds.length === 0
        ? eq(shifts.status, "rostered")
        : or(eq(shifts.status, "rostered"), and(inArray(shifts.id, [...resolvedShiftIds]), inArray(shifts.status, ["worked", "absent"])))!,
    ];
    if (isScopedCaller(caller)) {
      conditions.push(facilityFilter(caller.access.locationIds, shifts.locationId));
    }
    const marked = await tx
      .update(shifts)
      .set({ status: "leave", updatedBy: ctx.userId })
      .where(and(...conditions))
      .returning({ id: shifts.id });
    if (resolvedShiftIds.some((id) => !marked.some((row) => row.id === id))) {
      throw new Error("A resolved shift could not be marked for leave.");
    }
    shiftsMarked = marked.length;
  }

  await writeAuditRow(tx, {
    entityId: request.id,
    before: { status: request.status },
    after: {
      status: decision,
      decidedBy: decider,
      decidedAt: decidedAt.toISOString(),
      decisionNote: input.note ?? null,
      shiftsMarked,
      resolvedShiftIds: [...resolvedShiftIds],
    },
  });

  return { ok: true, shiftsMarked };
}
