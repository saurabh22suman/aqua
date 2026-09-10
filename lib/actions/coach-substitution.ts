"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  substituteCoach,
  type SubstituteCoachResult,
} from "@/lib/services/coach-substitution";

// Phase R.1 — coach substitution action. parse-then-permission
// preamble; management-only (the owner/admin does the
// substitute; the coach can't self-substitute).

const subSchema = z.object({
  sessionId: z.string().uuid(),
  newCoachId: z.string().uuid(),
});

export async function substituteCoachAction(
  raw: unknown,
): Promise<SubstituteCoachResult> {
  const parsed = subSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid substitute request." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "programs.write");
  return substituteCoach({ tenantId: ctx.tenantId, userId: ctx.userId }, parsed.data);
}
