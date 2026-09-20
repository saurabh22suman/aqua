import { and, between, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { writeAudit } from "@/lib/audit/write";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
import {
  balancesInTx,
  daysInclusive,
  yearBounds,
  type LeaveBalanceRow,
} from "@/lib/services/leave-balances";
import type { LeaveRequestRow } from "@/lib/services/leave-approval";
import type { ActionCtx } from "@/lib/auth/context";

// V-26 — leave requests and the staff member's own view. Types live in
// ./leave-types, balance maths in ./leave-balances, the owner queue and
// decisions in ./leave-approval; all re-exported below so callers keep
// one import path.

export * from "./leave-types";
export * from "./leave-balances";
export * from "./leave-approval";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const leaveRequestInput = z.object({
  leaveTypeId: uuid,
  fromDate: isoDate,
  toDate: isoDate,
  reason: z.string().trim().max(500).nullish(),
});

export const leaveYearInput = z.object({
  year: z.number().int().min(2000).max(2100),
});

export type LeaveRequestResult =
  | { ok: true; requestId: string; days: number }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid leave input.";
}

export async function requestLeave(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LeaveRequestResult> {
  const parsed = leaveRequestInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  if (input.toDate < input.fromDate) {
    return { ok: false, error: "The end date must be on or after the start date." };
  }
  const days = daysInclusive(input.fromDate, input.toDate);
  const year = Number(input.fromDate.slice(0, 4));

  return withTenant(ctx.tenantId, async (tx) => {
    const staffId = await ownStaffIdInTx(tx, ctx);
    if (!staffId) {
      return { ok: false, error: "Your login is not linked to a staff record." };
    }

    const [type] = await tx
      .select()
      .from(leaveTypes)
      .where(
        and(
          eq(leaveTypes.id, input.leaveTypeId),
          eq(leaveTypes.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    if (!type) return { ok: false, error: "Leave type not found." };

    if (type.annualQuota !== null) {
      const balances = await balancesInTx(tx, ctx.tenantId, staffId, year);
      const balance = balances.find((b) => b.leaveTypeId === type.id);
      const available = balance?.availableDays ?? type.annualQuota;
      if (days > available) {
        return {
          ok: false,
          error: `Only ${available} day${available === 1 ? "" : "s"} of ${type.name} leave left this year.`,
        };
      }
    }

    const [inserted] = await tx
      .insert(leaveRequests)
      .values({
        tenantId: ctx.tenantId,
        staffId,
        leaveTypeId: type.id,
        fromDate: input.fromDate,
        toDate: input.toDate,
        days: String(days),
        reason: input.reason ?? null,
        status: "pending",
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: leaveRequests.id });
    if (!inserted) return { ok: false, error: "The request could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "leave.request",
      entityType: "leave_request",
      entityId: inserted.id,
      after: {
        staffId,
        leaveTypeId: type.id,
        fromDate: input.fromDate,
        toDate: input.toDate,
        days,
        status: "pending",
      },
    });

    return { ok: true, requestId: inserted.id, days };
  });
}

export async function cancelLeaveRequest(
  ctx: ActionCtx,
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = uuid.safeParse(requestId);
  if (!parsed.success) return { ok: false, error: "Invalid leave request." };

  return withTenant(ctx.tenantId, async (tx) => {
    const staffId = await ownStaffIdInTx(tx, ctx);
    if (!staffId) {
      return { ok: false, error: "Your login is not linked to a staff record." };
    }

    const [request] = await tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.id, parsed.data),
          eq(leaveRequests.tenantId, ctx.tenantId),
          eq(leaveRequests.staffId, staffId),
        ),
      )
      .for("update");
    if (!request) return { ok: false, error: "Leave request not found." };
    if (request.status !== "pending") {
      return { ok: false, error: "Only a pending request can be cancelled." };
    }

    await tx
      .update(leaveRequests)
      .set({ status: "cancelled", updatedBy: ctx.userId, updatedAt: new Date() })
      .where(
        and(
          eq(leaveRequests.id, request.id),
          eq(leaveRequests.tenantId, ctx.tenantId),
        ),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "leave.cancel",
      entityType: "leave_request",
      entityId: request.id,
      before: { status: request.status },
      after: { status: "cancelled" },
    });

    return { ok: true };
  });
}

export async function listMyLeave(
  ctx: ActionCtx,
  raw: unknown,
): Promise<{ balances: LeaveBalanceRow[]; requests: LeaveRequestRow[] }> {
  const parsed = leaveYearInput.safeParse(raw);
  if (!parsed.success) return { balances: [], requests: [] };
  const { year } = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const staffId = await ownStaffIdInTx(tx, ctx);
    if (!staffId) return { balances: [], requests: [] };

    const balances = await balancesInTx(tx, ctx.tenantId, staffId, year);
    const bounds = yearBounds(year);
    const rows = await tx
      .select({
        id: leaveRequests.id,
        staffId: leaveRequests.staffId,
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
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.tenantId, ctx.tenantId),
          eq(leaveRequests.staffId, staffId),
          between(leaveRequests.fromDate, bounds.fromDate, bounds.toDate),
        ),
      )
      .orderBy(desc(leaveRequests.fromDate));

    return {
      balances,
      requests: rows.map((r) => ({
        ...r,
        staffName: "",
        days: Number(r.days),
        decidedAt: r.decidedAt?.toISOString() ?? null,
      })),
    };
  });
}
