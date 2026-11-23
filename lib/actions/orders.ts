"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasFeature, requirePermission } from "@/lib/auth/permission";
import {
  createOrder,
  finalizeOrder,
  listOpenCafeOrders,
  requestCafeBill,
  voidOrder,
  type CafeBillResult,
  type CreateOrderResult,
  type FinalizeOrderResult,
  type OpenCafeOrderRow,
  type VoidOrderResult,
} from "@/lib/services/orders";

// K-02/K-03 — counter order actions. Recording and billing ride
// payments.record (reception holds it); reads are out of this slice
// (a separate workstream renders the screens). Standing preamble:
// zod parse first, permission check next, service call last.

const createInput = z.object({
  locationId: z.string().uuid(),
  memberId: z.string().uuid().nullish(),
  expectedTaxRegistered: z.boolean().optional(),
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
  // K-02 café entitlement. NEW café module work needs the café
  // entitlement, not only the `payments.record` grant: `payments.record`
  // resolves the `billing` module, and `cafe.pos` is a separate,
  // separately-entitled module that the standard plan does not carry.
  //
  // This guard is CREATE-ONLY on purpose. An order that already exists
  // stays billable, voidable and collectable under the existing
  // permissions after the entitlement is switched off (the operator's
  // policy: a disabled café blocks NEW module work, not the settlement of
  // historical billing). The finalize / void / open-list / request-bill
  // actions are deliberately left unchanged.
  if (!hasFeature(ctx, "cafe.pos")) {
    return {
      ok: false,
      error: "The café module is not enabled for this club.",
    };
  }
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

// K-08 — reception café billing flow. The open-order list is a counter
// read; requesting the bill issues the invoice through the K-03 bridge
// and returns the itemized amount due. Both ride payments.record, the
// same permission that reads the counter and settles the bill.

const openOrdersInput = z.object({
  locationId: z.string().uuid().optional(),
});

export async function listOpenCafeOrdersAction(
  raw: unknown,
): Promise<OpenCafeOrderRow[]> {
  const parsed = openOrdersInput.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return listOpenCafeOrders(ctx, parsed.data);
}

export async function requestCafeBillAction(
  raw: unknown,
): Promise<CafeBillResult> {
  const parsed = orderInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return requestCafeBill(ctx, parsed.data.orderId);
}
