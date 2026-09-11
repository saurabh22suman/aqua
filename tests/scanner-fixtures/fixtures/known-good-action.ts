// D2 — known-good fixture for the action-permission scan.
//
// A 'use server' file whose exported function DOES call
// requirePermission. The scanner passes this file; the
// known-bad fixture is what flags the bad shape.
//
// Lives under tests/scanner-fixtures/ (outside the production
// scanned tree) so the scanner never accidentally scans itself.

"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { getOwnerDashboard, type OwnerDashboardData } from "@/lib/services/dashboard";

export async function goodDashboardAction(): Promise<OwnerDashboardData> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "dashboard.view");
  return getOwnerDashboard({ tenantId: ctx.tenantId });
}