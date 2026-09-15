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
import {
  listCashCountHistory,
  reopenCashCount,
  type CashCountHistoryRow,
  type ReopenCashCountResult,
} from "@/lib/services/reconciliation-closed-state";

// C-34 — daily collection report + cash count. The report is
// accountant-grade money provenance, so it reads under
// reports.financial; confirming a count is a counter action
// (payments.record), the same people who took the money — the
// service itself gates the >₹2,000 close on settings.manage, using
// the permission set requireDefaultCtx() already resolved onto ctx.
//
// Reopening a closed day is a bigger deal than confirming one (it's
// the only way to undo a close, and it's exactly the escape hatch a
// dishonest recount would want) — gated at settings.manage, the same
// owner/admin-only permission the over-threshold close uses.

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

const reopenInput = z.object({
  locationId: z.string().uuid(),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1).max(500),
});

const historyInput = z.object({
  locationId: z.string().uuid(),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

export async function reopenCashCountAction(
  raw: unknown,
): Promise<ReopenCashCountResult> {
  const parsed = reopenInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "A reason is required to reopen a count.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return reopenCashCount(ctx, parsed.data);
}

export async function listCashCountHistoryAction(
  raw: unknown,
): Promise<CashCountHistoryRow[]> {
  const parsed = historyInput.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.financial");
  return listCashCountHistory(ctx, parsed.data);
}
