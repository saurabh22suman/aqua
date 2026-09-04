"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import {
  grantMakeupCredit,
  redeemMakeupCredit,
  type MakeupCreditResult,
} from "@/lib/services/makeup";

// Phase R.7 — V.18 makeup credits action. parse-then-permission
// preamble; management-only (a coach can't self-grant a makeup
// credit on themselves).

const grantSchema = z.object({
  memberId: z.string().uuid(),
  sourceSessionId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

const redeemSchema = z.object({
  memberId: z.string().uuid(),
  sourceSessionId: z.string().uuid(),
  targetSessionId: z.string().uuid(),
});

export async function grantMakeupCreditAction(
  raw: unknown,
): Promise<MakeupCreditResult> {
  const parsed = grantSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid grant." };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return grantMakeupCredit(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    {
      memberId: parsed.data.memberId,
      sourceSessionId: parsed.data.sourceSessionId,
      expiresAt: parsed.data.expiresAt
        ? new Date(parsed.data.expiresAt)
        : undefined,
    },
  );
}

export async function redeemMakeupCreditAction(
  raw: unknown,
): Promise<MakeupCreditResult> {
  const parsed = redeemSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid redemption." };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return redeemMakeupCredit(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    parsed.data,
  );
}
