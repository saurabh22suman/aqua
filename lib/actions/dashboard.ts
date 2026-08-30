"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import { getOwnerDashboard, type OwnerDashboardData } from "@/lib/services/dashboard";

export async function getOwnerDashboardAction(): Promise<OwnerDashboardData> {
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return getOwnerDashboard({ tenantId: ctx.tenantId });
}
