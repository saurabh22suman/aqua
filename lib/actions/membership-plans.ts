"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  activatePlanFromShape,
  archivePlan,
  createPlan,
  listPlanTemplates,
  listPlans,
  updatePlan,
  type PlanMutationResult,
  type PlanRow,
  type PlanTemplateRow,
} from "@/lib/services/membership-plans";

// C-29 — plan management actions. Reads need settings.read (the member
// subscription panel also reads plans for its picker); writes need
// settings.manage (owner/admin).

const archiveInput = z.object({ id: z.string().uuid() });

export async function listPlansAction(): Promise<PlanRow[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  return listPlans(ctx);
}

export async function listPlanTemplatesAction(): Promise<PlanTemplateRow[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  return listPlanTemplates(ctx);
}

export async function activatePlanFromShapeAction(
  raw: unknown,
): Promise<PlanMutationResult> {
  const parsed = z
    .object({ shapeId: z.string().uuid() })
    .passthrough()
    .safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid plan template." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return activatePlanFromShape(ctx, raw);
}

export async function createPlanAction(
  raw: unknown,
): Promise<PlanMutationResult> {
  const parsed = z.object({ name: z.string() }).passthrough().safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid plan." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return createPlan(ctx, raw);
}

export async function updatePlanAction(
  raw: unknown,
): Promise<PlanMutationResult> {
  const parsed = z.object({ id: z.string().uuid() }).passthrough().safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid plan update." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return updatePlan(ctx, raw);
}

export async function archivePlanAction(
  raw: unknown,
): Promise<PlanMutationResult> {
  const parsed = archiveInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid plan reference." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return archivePlan(ctx, parsed.data.id);
}
