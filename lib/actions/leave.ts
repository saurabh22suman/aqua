"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  cancelLeaveRequest,
  createLeaveType,
  leaveListInput,
  leaveRequestInput,
  leaveTypeInput,
  leaveTypeUpdateInput,
  leaveYearInput,
  listLeaveRequests,
  listLeaveTypes,
  listMyLeave,
  requestLeave,
  updateLeaveType,
  type LeaveBalanceRow,
  type LeaveRequestResult,
  type LeaveRequestRow,
  type LeaveTypeResult,
  type LeaveTypeRow,
} from "@/lib/services/leave";

// V-26 — leave actions. Standing preamble: (1) Zod parse, (2) a
// permission check before any service call. Staff request and cancel
// their own leave under staff.self; managing types and reading the
// request queue is staff.roster (owner/admin/worker-template).

const uuid = z.string().uuid();

export async function listLeaveTypesAction(): Promise<LeaveTypeRow[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return listLeaveTypes(ctx);
}

export async function createLeaveTypeAction(
  raw: unknown,
): Promise<LeaveTypeResult> {
  const parsed = leaveTypeInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid leave type.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return createLeaveType(ctx, parsed.data);
}

export async function updateLeaveTypeAction(
  raw: unknown,
): Promise<LeaveTypeResult> {
  const parsed = leaveTypeUpdateInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid leave type.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return updateLeaveType(ctx, parsed.data);
}

export async function requestLeaveAction(
  raw: unknown,
): Promise<LeaveRequestResult> {
  const parsed = leaveRequestInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid leave request.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return requestLeave(ctx, parsed.data);
}

export async function cancelLeaveRequestAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid leave request." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return cancelLeaveRequest(ctx, parsed.data);
}

export async function listMyLeaveAction(
  raw: unknown,
): Promise<{ balances: LeaveBalanceRow[]; requests: LeaveRequestRow[] }> {
  const parsed = leaveYearInput.safeParse(raw);
  if (!parsed.success) return { balances: [], requests: [] };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return listMyLeave(ctx, parsed.data);
}

export async function listLeaveRequestsAction(
  raw: unknown,
): Promise<LeaveRequestRow[]> {
  const parsed = leaveListInput.safeParse(raw ?? {});
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return listLeaveRequests(ctx, parsed.data);
}
