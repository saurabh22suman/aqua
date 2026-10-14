"use server";

import { z } from "zod";
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
//
// W1-6 continuation — an optional `facility` (a location UUID) scopes
// every series the same way the owner's facility switcher does. The
// value is only ever a shape check here; the service combines it with
// the standard location predicate, so an unseen location returns no
// rows rather than widening access.

const facilitySchema = z.string().uuid().optional();

export async function getOperationalAnalyticsAction(
  raw: unknown,
  facility?: string,
): Promise<OperationalAnalytics> {
  const period = reportPeriodSchema.parse(raw);
  const locationId = facilitySchema.parse(facility);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.operational");
  return getOperationalAnalytics({ tenantId: ctx.tenantId }, period, { locationId });
}

export async function getMoneyAnalyticsAction(
  raw: unknown,
  facility?: string,
): Promise<MoneyAnalytics> {
  const period = reportPeriodSchema.parse(raw);
  const locationId = facilitySchema.parse(facility);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.financial");
  return getMoneyAnalytics({ tenantId: ctx.tenantId }, period, { locationId });
}
