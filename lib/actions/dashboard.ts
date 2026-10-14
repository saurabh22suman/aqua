"use server";

import { z } from "zod";
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
//
// W1-6 continuation — the optional `facility` argument carries the
// owner's facility-switcher choice. Shape-checked here; the service
// combines it with the location predicate so it can only narrow.
//
// A07 (docs/audits/2026-10-09-role-content-permission-audit.md) — the
// complete authenticated ctx (including allLocations/locationIds) is
// forwarded: dropping it to just tenantId is what let a restricted
// Admin's dashboard read every site. The service now resolves the
// allowed-location boundary from this ctx, and `facility` can only
// narrow within it.

const inputSchema = z
  .object({ facility: z.string().uuid().optional() })
  .optional();

export async function getOwnerDashboardAction(raw?: unknown): Promise<OwnerDashboardData> {
  const parsed = inputSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "dashboard.view");
  return getOwnerDashboard(ctx, { locationId: parsed?.facility });
}
