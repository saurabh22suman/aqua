"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  createOrder,
  finalizeOrder,
  voidOrder,
  type CreateOrderResult,
  type FinalizeOrderResult,
  type VoidOrderResult,
} from "@/lib/services/orders";

// K-02/K-03 — counter order actions. Recording and billing ride
// payments.record (reception holds it); reads are out of this slice
// (a separate workstream renders the screens). Standing preamble:
// zod parse first, permission check next, service call last.

const createInput = z.object({
  locationId: z.string().uuid(),
  memberId: z.string().uuid().nullish(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        qty: z.number().int().positive().max(1000),
      }),
    )
    .min(1)
    .max(100),
});

const orderInput = z.object({ orderId: z.string().uuid() });

const voidInput = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});

export async function createOrderAction(
  raw: unknown,
): Promise<CreateOrderResult> {
  const parsed = createInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid order." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return createOrder(ctx, parsed.data);
}

export async function finalizeOrderAction(
  raw: unknown,
): Promise<FinalizeOrderResult> {
  const parsed = orderInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return finalizeOrder(ctx, parsed.data.orderId);
}

export async function voidOrderAction(raw: unknown): Promise<VoidOrderResult> {
  const parsed = voidInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Give a reason (3-300 characters)." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return voidOrder(ctx, parsed.data.orderId, parsed.data.reason);
}
