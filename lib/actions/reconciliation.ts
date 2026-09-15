"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  confirmCashCount,
  getDailyCollection,
  type ConfirmCashCountResult,
  type DailyCollection,
} from "@/lib/services/reconciliation";

// C-34 — daily collection report + cash count. The report is
// accountant-grade money provenance, so it reads under
// reports.financial; confirming a count is a counter action
// (payments.record), the same people who took the money.

const dailyInput = z.object({
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locationId: z.string().uuid().optional(),
});

const confirmInput = z.object({
  locationId: z.string().uuid(),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  countedPaise: z.number().int().min(0).max(10_000_000_000),
  note: z.string().trim().min(1).max(500).optional(),
});

export async function getDailyCollectionAction(
  raw: unknown,
): Promise<DailyCollection> {
  const parsed = dailyInput.safeParse(raw);
  if (!parsed.success) {
    return {
      onDate: "",
      totalPaise: 0,
      paymentCount: 0,
      cashPaise: 0,
      byMethod: [],
      byStaff: [],
      cashCount: null,
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.financial");
  return getDailyCollection(ctx, parsed.data);
}

export async function confirmCashCountAction(
  raw: unknown,
): Promise<ConfirmCashCountResult> {
  const parsed = confirmInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid cash count.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return confirmCashCount(ctx, parsed.data);
}
