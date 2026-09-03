"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import { transferMemberToBatch, type TransferBatchResult } from "@/lib/services/transfer";

// Phase R.6 — V.19 batch transfer action. parse-then-permission
// preamble; management-only (a coach doesn't have authority to
// move a swimmer between batches, that's a roster-level call).

const transferSchema = z.object({
  memberId: z.string().uuid(),
  fromBatchId: z.string().uuid(),
  toBatchId: z.string().uuid(),
});

export async function transferMemberToBatchAction(
  raw: unknown,
): Promise<TransferBatchResult> {
  const parsed = transferSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: "Invalid transfer request.",
    };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return transferMemberToBatch(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    parsed.data,
  );
}
