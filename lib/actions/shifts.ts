"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  createShift,
  createShiftTemplate,
  deleteShift,
  listMyPublishedShifts,
  listRosterWeek,
  listShiftTemplates,
  publishRosterWeek,
  rosterRangeInput,
  shiftInput,
  shiftTemplateInput,
  publishRosterInput,
  type MyShiftRow,
  type RosterShiftRow,
  type ShiftResult,
  type ShiftTemplateRow,
  type TemplateResult,
} from "@/lib/services/shifts";

// V-23 — roster actions. Standing preamble: (1) Zod parse, (2) a
// permission check before any service call. Building the roster is
// `staff.roster` (owner/admin/worker-template); the staff member's own
// published shifts are `staff.self`, so a coach can read their roster
// without holding roster-building rights.

const uuid = z.string().uuid();

export async function listShiftTemplatesAction(
  raw: unknown,
): Promise<ShiftTemplateRow[]> {
  const parsed = z.object({ locationId: uuid.optional() }).safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return listShiftTemplates(ctx, parsed.data);
}

export async function createShiftTemplateAction(
  raw: unknown,
): Promise<TemplateResult> {
  const parsed = shiftTemplateInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid template.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return createShiftTemplate(ctx, parsed.data);
}

export async function createShiftAction(raw: unknown): Promise<ShiftResult> {
  const parsed = shiftInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid shift.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return createShift(ctx, parsed.data);
}

export async function deleteShiftAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid shift." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return deleteShift(ctx, parsed.data);
}

export async function listRosterWeekAction(
  raw: unknown,
): Promise<RosterShiftRow[]> {
  const parsed = rosterRangeInput.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return listRosterWeek(ctx, parsed.data);
}

export async function publishRosterAction(
  raw: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = publishRosterInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid publish request.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.roster");
  return publishRosterWeek(ctx, parsed.data);
}

// The staff-facing read. `staff.self` is held by coach/receptionist/
// accountant/worker; the service returns only the caller's own
// published shifts, so the key is not a window onto anyone else's
// roster.
export async function listMyShiftsAction(raw: unknown): Promise<MyShiftRow[]> {
  const parsed = rosterRangeInput.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  return listMyPublishedShifts(ctx, parsed.data);
}
