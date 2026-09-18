"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { reportPeriodSchema } from "@/lib/services/owner-reports";
import {
  getMoneyAnalytics,
  getOperationalAnalytics,
  type MoneyAnalytics,
  type OperationalAnalytics,
} from "@/lib/services/owner-analytics";

// U-01 — owner analytics actions. Standing preamble: (1) Zod parse,
// (2) permission check. Attendance and member mix are operational
// reports; collections and plan revenue are financial.

export async function getOperationalAnalyticsAction(
  raw: unknown,
): Promise<OperationalAnalytics> {
  const period = reportPeriodSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.operational");
  return getOperationalAnalytics({ tenantId: ctx.tenantId }, period);
}

export async function getMoneyAnalyticsAction(
  raw: unknown,
): Promise<MoneyAnalytics> {
  const period = reportPeriodSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.financial");
  return getMoneyAnalytics({ tenantId: ctx.tenantId }, period);
}
