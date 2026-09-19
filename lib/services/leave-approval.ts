import { and, asc, between, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { shifts } from "@/db/schema/shifts";
import { sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { staff } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
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

export type LeaveDecisionResult =
  | { ok: true; shiftsMarked: number }
  | { ok: false; error: string };

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
    const [request] = await tx
      .select({
        staffId: leaveRequests.staffId,
        fromDate: leaveRequests.fromDate,
        toDate: leaveRequests.toDate,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.id, parsed.data.requestId),
          eq(leaveRequests.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    if (!request) return [];

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
      .where(
        and(
          eq(sessions.tenantId, ctx.tenantId),
          eq(sessions.coachId, request.staffId),
          between(sessions.sessionDate, request.fromDate, request.toDate),
          inArray(sessions.status, ["scheduled", "held"]),
        ),
      )
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

  return withTenant(ctx.tenantId, async (tx) => {
    const decider = await ownStaffIdInTx(tx, ctx);
    if (!decider) {
      return { ok: false, error: "Your login is not linked to a staff record." };
    }

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
    if (!request) return { ok: false, error: "Leave request not found." };
    if (request.status !== "pending") {
      return { ok: false, error: "This request has already been decided." };
    }

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
      const marked = await tx
        .update(shifts)
        .set({ status: "leave", updatedBy: ctx.userId })
        .where(
          and(
            eq(shifts.tenantId, ctx.tenantId),
            eq(shifts.staffId, request.staffId),
            between(shifts.shiftDate, request.fromDate, request.toDate),
            eq(shifts.status, "rostered"),
          ),
        )
        .returning({ id: shifts.id });
      shiftsMarked = marked.length;
    }

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: decision === "approved" ? "leave.approve" : "leave.reject",
      entityType: "leave_request",
      entityId: request.id,
      before: { status: request.status },
      after: {
        status: decision,
        decidedBy: decider,
        decidedAt: decidedAt.toISOString(),
        decisionNote: input.note ?? null,
        shiftsMarked,
      },
    });

    return { ok: true, shiftsMarked };
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
