"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  getScheduleGrid,
  gridRangeInput,
  type GridSessionRow,
} from "@/lib/services/schedule-grid";

// U-04 — owner schedule grid read. Standing preamble: (1) Zod parse,
// (2) permission check. Reading the schedule rides attendance.read,
// the same key the existing owner sessions list uses.

export async function getScheduleGridAction(
  raw: unknown,
): Promise<GridSessionRow[]> {
  const parsed = gridRangeInput.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "attendance.read");
  return getScheduleGrid(ctx, parsed.data);
}
