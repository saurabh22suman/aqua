"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import {
  ForbiddenError,
  hasFeature,
  hasPermission,
  requirePermission,
} from "@/lib/auth/permission";
import { getOwnerDashboard } from "@/lib/services/dashboard";
import { getOwnerCharts } from "@/lib/services/owner-home-charts";
import {
  buildOwnerHomeBriefView,
  getOwnerHomeFacilityMoney,
  listOwnerBriefFacilities,
  type OwnerBriefFacilityMoney,
  type OwnerBriefView,
} from "@/lib/services/owner-home-brief";
import { getBranding } from "@/lib/services/branding";

// 21 November 2026 — Owner Home brief actions.
//
// Both are OWNER-role only: the page renders the brief composition only for
// ctx.roleKey === "owner", and a direct POST cannot turn the same composition
// on for an Admin. They then enforce the ordinary dashboard/finance grants;
// every figure is still resolved under the caller's live location access by
// the existing services.
//
// The facility-switch action returns a complete scoped view so the control can
// keep the committed figures on screen until the matching read succeeds, show
// a retry on failure, and only then move the scope label.

const switchInput = z
  .object({ facility: z.string().uuid().optional() })
  .optional();

export async function getOwnerHomeBriefAction(
  raw?: unknown,
): Promise<OwnerBriefView> {
  const parsed = switchInput.parse(raw);
  const ctx = await requireDefaultCtx();
  if (ctx.roleKey !== "owner") {
    throw new ForbiddenError("dashboard.view", "role_grant_missing");
  }
  requirePermission(ctx, "dashboard.view");
  const canReadFees =
    hasPermission(ctx, "reports.financial") &&
    hasPermission(ctx, "invoices.read") &&
    hasFeature(ctx, "billing");
  const facility = parsed?.facility;
  const facilities = await listOwnerBriefFacilities(ctx);
  if (facility && !facilities.some(entry => entry.id === facility)) {
    throw new ForbiddenError("dashboard.view", "role_grant_missing");
  }
  const [data, charts, branding] = await Promise.all([
    getOwnerDashboard(ctx, facility ? { locationId: facility } : {}),
    canReadFees
      ? getOwnerCharts(ctx, {
          period: "last7",
          ...(facility ? { locationId: facility } : {}),
        }).catch(() => null)
      : Promise.resolve(null),
    getBranding(ctx),
  ]);
  return buildOwnerHomeBriefView({
    data,
    charts,
    facilities,
    branding,
    requestedFacility: facility ?? null,
    can: {
      fees: canReadFees,
      schedule: hasPermission(ctx, "attendance.read"),
      enquiries: hasPermission(ctx, "enquiries.read"),
    },
  });
}

const facilityMoneyInput = z.object({}).optional();

export async function getOwnerHomeFacilityMoneyAction(
  raw?: unknown,
): Promise<OwnerBriefFacilityMoney[]> {
  facilityMoneyInput.parse(raw);
  const ctx = await requireDefaultCtx();
  if (ctx.roleKey !== "owner") {
    throw new ForbiddenError("reports.financial", "role_grant_missing");
  }
  requirePermission(ctx, "dashboard.view");
  requirePermission(ctx, "reports.financial");
  requirePermission(ctx, "invoices.read");
  return getOwnerHomeFacilityMoney(ctx);
}
