"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { getOwnerDashboard, type OwnerDashboardData } from "@/lib/services/dashboard";

// D2 — dashboard.view, granted to owner + admin only. The
// previous "ungated by design" comment (K3 follow-up) is gone:
// the auditor demonstrated that a coach / receptionist /
// accountant can call this action over a direct Next-Action POST
// and receive the same roll-up an owner gets. The fix is the
// requirePermission line below; the deeper audit point
// (architecture §7.3: every action authorizes itself) is now
// enforced uniformly — see CLAUDE.md "layouts are for UI only".
//
// requireDefaultCtx still runs first: an unauthenticated caller
// or a caller with no tenant membership is bounced before the
// permission check. requirePermission then enforces the
// dashboard.view grant; an accountant with reports.operational
// but no dashboard.view is refused here, exactly the rule the
// audit landed.
export async function getOwnerDashboardAction(): Promise<OwnerDashboardData> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "dashboard.view");
  return getOwnerDashboard({ tenantId: ctx.tenantId });
}
