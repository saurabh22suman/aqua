"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  createBillingRegistrationSchema,
  resetSiteBillingSettingSchema,
  saveClubBillingDefaultSchema,
  saveSiteBillingSettingSchema,
} from "@/lib/services/facility-billing-contract";
import {
  createBillingRegistration,
  getClubBillingDefault,
  getSiteBillingSetting,
  resetSiteBillingSetting,
  saveClubBillingDefault,
  saveSiteBillingSetting,
} from "@/lib/services/facility-billing-settings";

export async function getClubBillingDefaultAction() {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return getClubBillingDefault(ctx);
}

export async function getSiteBillingSettingAction(raw: unknown) {
  const input = z.string().uuid().parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return getSiteBillingSetting(ctx, input);
}

export async function saveClubBillingDefaultAction(raw: unknown) {
  const input = saveClubBillingDefaultSchema.safeParse(raw);
  if (!input.success) return { ok: false as const, code: "invalid" as const, message: input.error.issues[0]?.message ?? "Invalid billing details." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return saveClubBillingDefault(ctx, input.data);
}

export async function saveSiteBillingSettingAction(raw: unknown) {
  const input = saveSiteBillingSettingSchema.safeParse(raw);
  if (!input.success) return { ok: false as const, code: "invalid" as const, message: input.error.issues[0]?.message ?? "Invalid facility details." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return saveSiteBillingSetting(ctx, input.data);
}

export async function resetSiteBillingSettingAction(raw: unknown) {
  const input = resetSiteBillingSettingSchema.safeParse(raw);
  if (!input.success) return { ok: false as const, code: "invalid" as const, message: "Invalid facility." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return resetSiteBillingSetting(ctx, input.data);
}

export async function createBillingRegistrationAction(raw: unknown) {
  const input = createBillingRegistrationSchema.safeParse(raw);
  if (!input.success) return { ok: false as const, code: "invalid" as const, message: input.error.issues[0]?.message ?? "Invalid registration details." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return createBillingRegistration(ctx, input.data);
}
