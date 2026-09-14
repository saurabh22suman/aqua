"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  addSubUnit,
  createActivity,
  deleteActivity,
  listActivities,
  removeSubUnit,
  updateActivity,
  type ActivityMutationResult,
  type ActivityRow,
} from "@/lib/services/activities";

// Activity catalog actions (decision 2026-09-14). Reads need
// settings.read; writes need settings.manage (owner/admin). Ops uses
// the same service through platform actions.

const listInput = z.object({ locationId: z.string().uuid().optional() });
const idInput = z.object({ id: z.string().uuid() });

export async function listActivitiesAction(
  locationId?: string,
): Promise<ActivityRow[]> {
  const parsed = listInput.safeParse({ locationId });
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  return listActivities(ctx, parsed.data);
}

export async function createActivityAction(
  raw: unknown,
): Promise<ActivityMutationResult> {
  const parsed = z
    .object({
      locationId: z.string().uuid(),
      name: z.string().trim().min(1),
      kind: z.string(),
    })
    .passthrough()
    .safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid activity." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return createActivity(ctx, raw);
}

export async function updateActivityAction(
  raw: unknown,
): Promise<ActivityMutationResult> {
  const parsed = idInput.passthrough().safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid activity update." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return updateActivity(ctx, raw);
}

export async function deleteActivityAction(
  raw: unknown,
): Promise<ActivityMutationResult> {
  const parsed = idInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid activity reference." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return deleteActivity(ctx, parsed.data.id);
}

export async function addSubUnitAction(
  raw: unknown,
): Promise<ActivityMutationResult> {
  const parsed = z
    .object({ activityId: z.string().uuid(), name: z.string().trim().min(1) })
    .safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid sub-unit." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return addSubUnit(ctx, parsed.data);
}

export async function removeSubUnitAction(
  raw: unknown,
): Promise<ActivityMutationResult> {
  const parsed = idInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid sub-unit reference." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return removeSubUnit(ctx, parsed.data);
}
