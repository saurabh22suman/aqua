"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  cancelSubscription,
  createSubscription,
  listMemberSubscriptions,
  pauseSubscription,
  resumeSubscription,
  type SubscriptionMutationResult,
  type SubscriptionRow,
} from "@/lib/services/subscriptions";

// C-30 — member subscription actions. Reading needs members.read;
// mutations need members.write (owner/admin/receptionist — front-desk
// enrolment works).

const memberIdInput = z.object({ memberId: z.string().uuid() });

export async function listMemberSubscriptionsAction(
  memberId: string,
): Promise<SubscriptionRow[]> {
  const parsed = memberIdInput.safeParse({ memberId });
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  return listMemberSubscriptions(ctx, parsed.data.memberId);
}

export async function createSubscriptionAction(
  raw: unknown,
): Promise<SubscriptionMutationResult> {
  const parsed = z
    .object({ memberId: z.string().uuid(), planId: z.string().uuid() })
    .passthrough()
    .safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Pick a member and a plan." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  return createSubscription(ctx, raw);
}

export async function pauseSubscriptionAction(
  raw: unknown,
): Promise<SubscriptionMutationResult> {
  const parsed = z.object({ id: z.string().uuid() }).passthrough().safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid subscription reference." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  return pauseSubscription(ctx, raw);
}

export async function resumeSubscriptionAction(
  raw: unknown,
): Promise<SubscriptionMutationResult> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid subscription reference." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  return resumeSubscription(ctx, parsed.data);
}

export async function cancelSubscriptionAction(
  raw: unknown,
): Promise<SubscriptionMutationResult> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid subscription reference." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  return cancelSubscription(ctx, parsed.data);
}
