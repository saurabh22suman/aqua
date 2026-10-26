"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { getOwnerCharts, type OwnerChartsData } from "@/lib/services/owner-home-charts";

// Owner Home charts. Standing preamble: Zod parse, then permission.
// dashboard.view is the Home gate (owner + admin); the figures come from
// the caller's resolved location access inside the service, so an
// optional facility can only narrow the read.

const inputSchema = z
  .object({
    period: z.enum(["day", "week", "month"]).optional(),
    facility: z.string().uuid().optional(),
  })
  .optional();

export async function getOwnerChartsAction(raw?: unknown): Promise<OwnerChartsData> {
  const parsed = inputSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "dashboard.view");
  return getOwnerCharts(ctx, {
    ...(parsed?.period ? { period: parsed.period } : {}),
    ...(parsed?.facility ? { locationId: parsed.facility } : {}),
  });
}
