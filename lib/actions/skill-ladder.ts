"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  listSkillLadders,
  updateSkillLevel,
  updateSkillLevelInput,
  updateSkillNode,
  updateSkillNodeInput,
  type LadderMutationResult,
  type SkillLadderRow,
} from "@/lib/services/skill-ladder";

// V-09 — skill-ladder editor actions. Listing rides levels.read (the
// same read the coach's progress view uses); editing a ladder is a
// settings change and rides settings.manage, which only owner/admin
// carry. The ladder is the generic framework the bridge populated —
// every update audits one row (skill_level.update / skill_node.update)
// in the same transaction, inside the service.

export async function listSkillLaddersAction(): Promise<SkillLadderRow[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "levels.read");
  return listSkillLadders(ctx);
}

export async function updateSkillLevelAction(
  raw: unknown,
): Promise<LadderMutationResult> {
  const parsed = updateSkillLevelInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid skill level.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return updateSkillLevel(ctx, parsed.data);
}

export async function updateSkillNodeAction(
  raw: unknown,
): Promise<LadderMutationResult> {
  const parsed = updateSkillNodeInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid skill.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return updateSkillNode(ctx, parsed.data);
}
