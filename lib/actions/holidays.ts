"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import {
  addHoliday,
  removeHoliday,
  type HolidayResult,
} from "@/lib/services/holidays";

// Phase R.3 — holiday actions. parse-then-permission preamble;
// management-only (a coach doesn't declare academy holidays).

const addSchema = z.object({
  name: z.string().trim().min(1).max(120),
  holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recurringYearly: z.boolean().optional().default(false),
});

const removeSchema = z.object({
  holidayId: z.string().uuid(),
});

export async function addHolidayAction(
  raw: unknown,
): Promise<HolidayResult> {
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid holiday." };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return addHoliday(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    parsed.data,
  );
}

export async function removeHolidayAction(
  raw: unknown,
): Promise<HolidayResult> {
  const parsed = removeSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid holiday id." };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return removeHoliday({ tenantId: ctx.tenantId, userId: ctx.userId }, parsed.data);
}
