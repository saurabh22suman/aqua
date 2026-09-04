"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import {
  addToWaitlist,
  cancelWaitlist,
  getWaitlistHead,
  promoteHead,
  type WaitlistResult,
  type WaitlistHead,
} from "@/lib/services/waitlist";

// Phase R.5 — waitlist actions. parse-then-permission preamble;
// staff-readable (a coach can add a member to the queue for
// their own batch; the owner can promote from the head).

const idSchema = z.object({
  memberId: z.string().uuid(),
  batchId: z.string().uuid(),
});

const batchSchema = z.object({
  batchId: z.string().uuid(),
});

export async function addToWaitlistAction(raw: unknown): Promise<WaitlistResult> {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid add." };
  }
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return addToWaitlist({ tenantId: ctx.tenantId, userId: ctx.userId }, parsed.data);
}

export async function cancelWaitlistAction(raw: unknown): Promise<WaitlistResult> {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid cancel." };
  }
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return cancelWaitlist({ tenantId: ctx.tenantId, userId: ctx.userId }, parsed.data);
}

export async function getWaitlistHeadAction(raw: unknown): Promise<WaitlistHead | null> {
  const parsed = batchSchema.safeParse(raw);
  if (!parsed.success) return null;
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return getWaitlistHead({ tenantId: ctx.tenantId, userId: ctx.userId }, parsed);
}

export async function promoteHeadAction(raw: unknown): Promise<WaitlistResult> {
  const parsed = batchSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid promote." };
  }
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return promoteHead({ tenantId: ctx.tenantId, userId: ctx.userId }, parsed);
}
