"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { todayInZone } from "@/lib/time/tz";
import {
  currentMonthPeriod,
  getBatchAttendanceSummary,
  getMemberAttendanceHistory,
  type BatchAttendanceSummary,
  type MemberAttendanceHistory,
} from "@/lib/services/attendance-history";
import type { TenantId } from "@/lib/ids";

const memberIdSchema = z.string().uuid();
const batchIdSchema = z.string().uuid();

async function tenantToday(tenantId: TenantId): Promise<string> {
  const [tenant] = await withTenant(tenantId, (tx) =>
    tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId)),
  );
  return todayInZone(tenant.timezone);
}

export async function getMemberAttendanceHistoryAction(
  rawMemberId: string,
): Promise<MemberAttendanceHistory> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  const today = await tenantToday(ctx.tenantId);
  return getMemberAttendanceHistory(ctx, memberId, currentMonthPeriod(today));
}

export async function getBatchAttendanceSummaryAction(
  rawBatchId: string,
): Promise<BatchAttendanceSummary | null> {
  const batchId = batchIdSchema.parse(rawBatchId);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  const today = await tenantToday(ctx.tenantId);
  return getBatchAttendanceSummary(ctx, batchId, currentMonthPeriod(today));
}
