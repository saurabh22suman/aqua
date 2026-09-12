"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  grantMakeupCredit,
  listMakeupCredits,
  listMakeupSources,
  listMakeupTargets,
  redeemMakeupCredit,
  type MakeupCreditResult,
  type MakeupCreditRow,
  type MakeupSessionOption,
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

const memberIdSchema = z.string().uuid();

export async function listMakeupCreditsAction(
  rawMemberId: string,
): Promise<MakeupCreditRow[]> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "attendance.read");
  return listMakeupCredits(ctx, memberId);
}

export async function listMakeupSourcesAction(
  rawMemberId: string,
): Promise<MakeupSessionOption[]> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "attendance.read");
  return listMakeupSources(ctx, memberId);
}

export async function listMakeupTargetsAction(
  rawMemberId: string,
): Promise<MakeupSessionOption[]> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "attendance.read");
  return listMakeupTargets(ctx, memberId);
}

export async function grantMakeupCreditAction(
  raw: unknown,
): Promise<MakeupCreditResult> {
  const parsed = grantSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid grant." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "attendance.mark");
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
  requirePermission(ctx, "attendance.mark");
  return redeemMakeupCredit(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    parsed.data,
  );
}
