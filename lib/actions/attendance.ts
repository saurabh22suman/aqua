"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { todayInZone } from "@/lib/time/tz";
import {
  currentMonthPeriod,
  getBatchAttendanceSummary,
  getMemberAttendanceHistory,
  lastDaysPeriod,
  type BatchAttendanceSummary,
  type MemberAttendanceHistory,
} from "@/lib/services/attendance-history";
import { ATTENDANCE_GRID_DAYS } from "@/lib/attendance-grid";
import type { TenantId } from "@/lib/ids";

const memberIdSchema = z.string().uuid();
const batchIdSchema = z.string().uuid();

async function tenantToday(tenantId: TenantId): Promise<string> {
  const [tenant] = await withTenant(tenantId, (tx) =>
    tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId)),
  );
  return todayInZone(tenant.timezone);
}

// The member page's attendance section is the 15-day grid
// (2026-09-15 redesign); `today` rides along so the client component
// can place the window and the "today" outline without a second
// round trip.
export async function getMemberAttendanceHistoryAction(
  rawMemberId: string,
): Promise<MemberAttendanceHistory & { today: string }> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "attendance.read");
  const today = await tenantToday(ctx.tenantId);
  const history = await getMemberAttendanceHistory(
    ctx,
    memberId,
    lastDaysPeriod(today, ATTENDANCE_GRID_DAYS),
  );
  return { ...history, today };
}

export async function getBatchAttendanceSummaryAction(
  rawBatchId: string,
): Promise<BatchAttendanceSummary | null> {
  const batchId = batchIdSchema.parse(rawBatchId);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "attendance.read");
  const today = await tenantToday(ctx.tenantId);
  return getBatchAttendanceSummary(ctx, batchId, currentMonthPeriod(today));
}
