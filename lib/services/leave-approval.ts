import { and, asc, between, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { staff } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import {
  decideLeaveRequest,
  type LeaveDecisionResult,
} from "@/lib/services/leave-decision";
import {
  leaveQueuePredicate,
  leaveSessionPredicate,
  resolveLeaveCaller,
} from "@/lib/services/leave-decision-scope";
import type { ActionCtx } from "@/lib/auth/context";

// V-27 — leave approval. Approving a request does two things in one
// transaction: it records the decision (who, when, why) and it moves
// the staff member's rostered shifts in the range to status 'leave'.
//
// Before deciding, the owner sees the sessions left uncovered —
// sessions where this staff member is the recorded coach during the
// leave. The task's done-when is that this surfaces *before* the day
// arrives, so the count rides the queue and the full list is one read
// away on the decision screen.

const uuid = z.string().uuid();

export const leaveListInput = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
});

export const leaveRequestIdInput = z.object({ requestId: uuid });

export const leaveDecisionInput = z.object({
  requestId: uuid,
  note: z.string().trim().max(500).nullish(),
});

export type LeaveRequestRow = {
  id: string;
  staffId: string;
  staffName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string | null;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
};

export type UncoveredSessionRow = {
  sessionId: string;
  batchId: string;
  batchName: string;
  sessionDate: string;
  startsAt: string;
  endsAt: string;
  status: string;
};

export type { LeaveDecisionResult };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid leave decision.";
}

export async function listLeaveRequests(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LeaveRequestRow[]> {
  const parsed = leaveListInput.safeParse(raw ?? {});
  if (!parsed.success) return [];
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(leaveRequests.tenantId, ctx.tenantId)];
    if (input.status) conditions.push(eq(leaveRequests.status, input.status));

    // THE CANONICAL SCOPE.
    //
    // The queue's visibility comes from the ONE resolver
    // (lib/services/location-access.ts). A facility-scoped MANAGER sees
    // exactly the requests it may DECIDE — the request's AFFECTED SHIFT
    // rows' facilities, all of them inside its own selection, and at
    // least one affected shift (a request with no affected shift is
    // owner-only); a location-scoped O-08 NON-MANAGER keeps the
    // canonical attachment-and-unlocated half; every other role keeps
    // the whole-tenant answer it has today; and a caller without a live
    // membership sees NOTHING.
    const caller = await resolveLeaveCaller(tx, ctx);
    if (caller.kind === "refused") return [];
    const scope = leaveQueuePredicate(
      tx,
      {
        staffIdColumn: leaveRequests.staffId,
        fromDateColumn: leaveRequests.fromDate,
        toDateColumn: leaveRequests.toDate,
      },
      caller,
      ctx.tenantId,
    );
    if (scope) conditions.push(scope);

    const rows = await tx
      .select({
        id: leaveRequests.id,
        staffId: leaveRequests.staffId,
        staffName: persons.fullName,
        leaveTypeId: leaveRequests.leaveTypeId,
        leaveTypeName: leaveTypes.name,
        fromDate: leaveRequests.fromDate,
        toDate: leaveRequests.toDate,
        days: leaveRequests.days,
        reason: leaveRequests.reason,
        status: leaveRequests.status,
        decidedAt: leaveRequests.decidedAt,
        decisionNote: leaveRequests.decisionNote,
      })
      .from(leaveRequests)
      .innerJoin(staff, eq(staff.id, leaveRequests.staffId))
      .innerJoin(persons, eq(persons.id, staff.personId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(...conditions))
      .orderBy(asc(leaveRequests.fromDate))
      .limit(100);

    return rows.map((r) => ({
      ...r,
      days: Number(r.days),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
  });
}

// Sessions the staff member is the recorded coach for, inside the
// leave range. Substitution (C-20) rewrites sessions.coach_id, so a
// substituted session is naturally no longer "uncovered" — whoever
// took it is on it.
export async function listUncoveredSessions(
  ctx: ActionCtx,
  raw: unknown,
): Promise<UncoveredSessionRow[]> {
  const parsed = leaveRequestIdInput.safeParse(raw);
  if (!parsed.success) return [];

  return withTenant(ctx.tenantId, async (tx) => {
    // THE CANONICAL SCOPE — THE REQUEST AND THE SESSIONS.
    //
    // A request the caller may not see in the queue must not become
    // readable through this by-id read, and a refused caller sees
    // nothing at all. The request is gated by the SAME criterion the
    // queue uses, so the two answers can never disagree about whether
    // the caller may see this request.
    const caller = await resolveLeaveCaller(tx, ctx);
    if (caller.kind === "refused") return [];

    const requestConditions = [
      eq(leaveRequests.id, parsed.data.requestId),
      eq(leaveRequests.tenantId, ctx.tenantId),
    ];
    const scope = leaveQueuePredicate(
      tx,
      {
        staffIdColumn: leaveRequests.staffId,
        fromDateColumn: leaveRequests.fromDate,
        toDateColumn: leaveRequests.toDate,
      },
      caller,
      ctx.tenantId,
    );
    if (scope) requestConditions.push(scope);

    const [request] = await tx
      .select({
        staffId: leaveRequests.staffId,
        fromDate: leaveRequests.fromDate,
        toDate: leaveRequests.toDate,
      })
      .from(leaveRequests)
      .where(and(...requestConditions))
      .limit(1);
    if (!request) return [];

    // THE SESSIONS ARE JUDGED BY THEIR OWN LOCATION.
    //
    // The session's own `location_id` decides the row, never the
    // request's: a session at a facility outside the caller's scope is
    // not listed, and a tenant-wide session (a NULL location) is
    // listed only while the caller's answer says `includeUnlocated`.
    const sessionConditions = [
      eq(sessions.tenantId, ctx.tenantId),
      eq(sessions.coachId, request.staffId),
      between(sessions.sessionDate, request.fromDate, request.toDate),
      inArray(sessions.status, ["scheduled", "held"]),
    ];
    const sessionScope = leaveSessionPredicate(sessions.locationId, caller);
    if (sessionScope) sessionConditions.push(sessionScope);

    const rows = await tx
      .select({
        sessionId: sessions.id,
        batchId: sessions.batchId,
        batchName: batches.name,
        sessionDate: sessions.sessionDate,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        status: sessions.status,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(and(...sessionConditions))
      .orderBy(asc(sessions.sessionDate), asc(sessions.startsAt));

    return rows.map((r) => ({
      ...r,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
    }));
  });
}

async function decide(
  ctx: ActionCtx,
  raw: unknown,
  decision: "approved" | "rejected",
): Promise<LeaveDecisionResult> {
  const parsed = leaveDecisionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  // THE AUDIT CALL SITE STAYS HERE.
  //
  // The protected tier-1 audit-coverage test pins this file as the
  // owner of the "leave.approve" / "leave.reject" audit rows
  // (tests/tier1/tenant-audit-coverage.test.ts), so the write and the
  // action name both live in this file. The decision calls the writer
  // from INSIDE its own transaction, so the audit row and the decision
  // row are still one atomic write.
  return decideLeaveRequest(ctx, input, decision, async (tx, audit) => {
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: decision === "approved" ? "leave.approve" : "leave.reject",
      entityType: "leave_request",
      entityId: audit.entityId,
      before: audit.before,
      after: audit.after,
    });
  });
}

export async function approveLeaveRequest(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LeaveDecisionResult> {
  return decide(ctx, raw, "approved");
}

export async function rejectLeaveRequest(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LeaveDecisionResult> {
  return decide(ctx, raw, "rejected");
}
