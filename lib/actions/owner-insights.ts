"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  getAttendanceByBatch,
  getEnquiryStageBreakdown,
  ownerInsightInputSchema,
  type AttendanceByBatchInsight,
  type EnquiryStageInsight,
} from "@/lib/services/owner-insights";

// The two owner-insight read models as Server Actions.
//
// The order is the contract: parse → session → permission → service.
//   * the period is the only input, and it is validated before the
//     session is even resolved;
//   * requireDefaultCtx() is the FULL authenticated context — the user,
//     the role, the resolved permission set and the caller's location
//     scope. A narrowed `{ tenantId }` literal here would drop the
//     location scope before the service could apply it;
//   * requirePermission carries BOTH the role grant and the tenant's
//     `reports` feature entitlement;
//   * the service applies its own gate as defence in depth, so a
//     future direct-import path cannot read without a grant either.
export async function getOwnerInsightsAttendanceAction(
  raw: unknown,
): Promise<AttendanceByBatchInsight> {
  const parsed = ownerInsightInputSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.operational");
  return getAttendanceByBatch(ctx, parsed);
}

export async function getOwnerInsightsEnquiryStagesAction(
  raw: unknown,
): Promise<EnquiryStageInsight> {
  const parsed = ownerInsightInputSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.operational");
  return getEnquiryStageBreakdown(ctx, parsed);
}
