"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  getAbsenceAlertThreshold,
  listMemberAlerts,
  updateAbsenceAlertThreshold,
  type MemberAlertRow,
} from "@/lib/services/absence-alerts";

// R.8 — absence alert actions. Parse-then-permission preamble; the
// threshold is an owner setting, the member list is the coach surface.

const memberIdSchema = z.string().uuid();

const thresholdSchema = z.object({
  thresholdPct: z.number().int().min(0).max(100),
});

export async function getAbsenceAlertThresholdAction(): Promise<number> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return getAbsenceAlertThreshold(ctx);
}

export async function updateAbsenceAlertThresholdAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = thresholdSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Threshold must be a whole number from 0 to 100." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return updateAbsenceAlertThreshold(ctx, parsed.data.thresholdPct);
}

export async function listMemberAlertsAction(
  rawMemberId: string,
): Promise<MemberAlertRow[]> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read.assigned");
  return listMemberAlerts(ctx, memberId);
}
