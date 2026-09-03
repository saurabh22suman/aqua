"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import {
  detectCoachConflicts,
  type CoachConflictCheckResult,
} from "@/lib/services/coach-conflicts";

export type { CoachConflict } from "@/lib/services/coach-conflicts";

// Phase R.2 — coach conflict detection action. parse-then-
// permission preamble; management-only (a coach can't run the
// conflict server-side check because the form reads-only in this
// scenario and the owner/admin side is what surfaces the
// warning).

const checkSchema = z.object({
  coachId: z.string().uuid().optional().or(z.literal("")).transform((v) => (v ? v : "")),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  excludeBatchId: z.string().uuid().optional(),
});

export async function checkCoachConflictsAction(
  raw: unknown,
): Promise<CoachConflictCheckResult> {
  const parsed = checkSchema.safeParse(raw);
  if (!parsed.success) {
    // Validation failure: surface as zero conflicts rather than
    // throwing — the form will simply not render a warning.
    // Throwing here would force the form to handle a parse error
    // path that is already covered by the standing
    // server-action-preamble structural test.
    return { conflicts: [] };
  }
  const input = parsed.data;
  if (!input.coachId) return { conflicts: [] };
  if (input.endTime <= input.startTime) return { conflicts: [] };
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return detectCoachConflicts(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    {
      coachId: input.coachId,
      daysOfWeek: input.daysOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      excludeBatchId: input.excludeBatchId,
    },
  );
}