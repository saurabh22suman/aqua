"use server";
import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { withdrawGuardianAuthorization, type WithdrawGuardianResult } from "@/lib/services/guardian-authorization";

export async function withdrawGuardianAuthorizationAction(raw: { guardianshipId: string; reason: string; confirmed: boolean }): Promise<WithdrawGuardianResult> {
  const input = z.object({ guardianshipId: z.string().uuid(), reason: z.string().trim().min(1).max(500), confirmed: z.literal(true) }).parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.link.confirm");
  requirePermission(ctx, "members.write");
  return withdrawGuardianAuthorization(ctx, input);
}
