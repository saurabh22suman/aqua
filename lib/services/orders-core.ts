import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { orders } from "@/db/schema/orders";
import type { TenantTx } from "@/db/tenant";
import type { TenantId } from "@/lib/ids";

// K-02/K-03 — shared shapes for the order services. Split out of
// lib/services/orders.ts (which re-exports the public surface) to keep
// every file under the 300-line rule.

export const uuid = z.string().uuid();

export const createOrderInput = z.object({
  locationId: uuid,
  memberId: uuid.nullish(),
  lines: z
    .array(
      z.object({
        itemId: uuid,
        qty: z.number().int().positive().max(1000),
      }),
    )
    .min(1, "An order needs at least one line.")
    .max(100),
});

export type CreateOrderInput = z.input<typeof createOrderInput>;

export type CreateOrderResult =
  | { ok: true; orderId: string; totalPaise: number }
  | { ok: false; error: string };

export type FinalizeOrderResult =
  | { ok: true; invoiceId: string; invoiceNumber: string }
  | { ok: false; error: string };

export type VoidOrderResult = { ok: true } | { ok: false; error: string };

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid order input.";
}

export async function lockedOrder(
  tx: TenantTx,
  tenantId: TenantId,
  orderId: string,
) {
  const rows = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .for("update");
  return rows[0];
}
