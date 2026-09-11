// D2 — known-bad fixture for the action-permission scan.
//
// A 'use server' file whose exported function does NOT call
// requirePermission. This is the exact bug shape the auditor
// caught in lib/actions/dashboard.ts — a `use server` action with
// only requireDefaultCtx and no permission gate.
//
// Lives under tests/scanner-fixtures/ (outside the production
// scanned tree) so the scanner never accidentally scans itself.

"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { getOwnerDashboard, type OwnerDashboardData } from "@/lib/services/dashboard";

export async function badDashboardAction(): Promise<OwnerDashboardData> {
  // The auditor's exact bug: requireDefaultCtx returns the user's
  // default tenant membership; the action then returns full owner
  // dashboard data without any role/permission check. A coach /
  // receptionist / accountant hitting this action via direct
  // Next-Action POST receives the same payload an owner does.
  const ctx = await requireDefaultCtx();
  return getOwnerDashboard({ tenantId: ctx.tenantId });
}