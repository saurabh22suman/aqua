"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  recordAssessment,
  recordAssessmentInput,
  type SkillMutationResult,
} from "@/lib/services/skill-framework";
import {
  getMemberProgress,
  type MemberProgress,
} from "@/lib/services/skill-progress";

// V-10 — assessment actions. Standing preamble: (1) Zod parse, then
// (2) permission check. Recording rides levels.assess (the coach role
// and the preset's vertical roles carry it); reading the progress view
// rides levels.read. Both resolve through the swim.levels feature
// module, so a tenant that disabled the module fails closed.

const memberIdInput = z.object({ memberId: z.string().uuid() });

export async function getMemberProgressAction(
  memberId: string,
): Promise<MemberProgress | null> {
  const parsed = memberIdInput.safeParse({ memberId });
  if (!parsed.success) return null;
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "levels.read");
  return getMemberProgress(ctx, parsed.data.memberId);
}

export async function recordAssessmentAction(
  raw: unknown,
): Promise<SkillMutationResult> {
  const parsed = recordAssessmentInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid assessment.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "levels.assess");
  return recordAssessment(ctx, parsed.data);
}
