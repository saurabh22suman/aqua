import { and, eq, inArray, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { orders, orderLines } from "@/db/schema/orders";
import { menuItems } from "@/db/schema/menu";
import { tenants } from "@/db/schema/tenants";
import { writeAudit } from "@/lib/audit/write";
import { gstDocumentKind } from "@/lib/gst";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { computeTax } from "@/lib/money/arithmetic";
import { asMemberId } from "@/lib/ids";
import {
  createOrderInput,
  firstIssue,
  type CreateOrderInput,
  type CreateOrderResult,
  type FinalizeOrderResult,
  type VoidOrderResult,
} from "@/lib/services/orders-core";
import type { ActionCtx } from "@/lib/auth/context";

// K-02/K-03 — counter order capture and the café → invoice bridge.
//
// createOrder snapshots name/price/tax-rate/SAC per line under
// withTenant, so a later menu edit never changes what was sold. The
// billing half (finalizeOrder/voidOrder) lives in
// lib/services/orders-billing.ts and is re-exported below so callers
// keep one import surface; the split keeps every file under the
// 300-line rule.

export * from "./orders-billing";
export * from "./cafe-billing";
export type {
  CreateOrderInput,
  CreateOrderResult,
  FinalizeOrderResult,
  VoidOrderResult,
};

export async function createOrder(
  ctx: ActionCtx,
  raw: unknown,
): Promise<CreateOrderResult> {
  const parsed = createOrderInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  // A counter order needs an actor for the audit row.
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, input.locationId)) {
      return { ok: false, error: "Location not found." };
    }

    const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
    const itemRows = await tx
      .select()
      .from(menuItems)
      .where(
        and(
          eq(menuItems.tenantId, ctx.tenantId),
          eq(menuItems.locationId, input.locationId),
          inArray(menuItems.id, itemIds),
          eq(menuItems.isActive, true),
          isNull(menuItems.deletedAt),
        ),
      );
    const byId = new Map(itemRows.map((item) => [item.id, item]));
    if (itemIds.some((id) => !byId.has(id))) {
      return {
        ok: false,
        error: "One or more items are not available on this menu.",
      };
    }

    // K-03/GST — an unregistered supplier cannot collect GST, and the
    // café invoice must equal the counter order to the paisa. The
    // document kind is therefore resolved here, where the snapshot is
    // born: a bill-of-supply tenant snapshots a zero rate/tax, so
    // finalizeOrder's trusted-snapshot path produces a tax-free
    // invoice that matches the order exactly. (Zeroing at invoice time
    // instead would silently break the order↔invoice equality the
    // café payment rules depend on.)
    const [tenantRow] = await tx
      .select({ gstin: tenants.gstin })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const registered = gstDocumentKind(tenantRow?.gstin ?? null) === "tax_invoice";

    const lines = input.lines.map((line) => {
      const item = byId.get(line.itemId)!;
      const linePaise = Number(BigInt(item.pricePaise) * BigInt(line.qty));
      const rateBp = registered ? item.taxRateBp : 0;
      return {
        itemId: item.id,
        itemName: item.name,
        qty: line.qty,
        unitPricePaise: Number(item.pricePaise),
        taxRateBp: rateBp,
        sacCode: item.sacCode,
        linePaise,
        taxPaise: computeTax(linePaise, rateBp),
      };
    });
    const totalPaise = lines.reduce(
      (sum, l) => sum + l.linePaise + l.taxPaise,
      0,
    );

    const [order] = await tx
      .insert(orders)
      .values({
        tenantId: ctx.tenantId,
        locationId: input.locationId,
        memberId: input.memberId ? asMemberId(input.memberId) : null,
        status: "placed",
        channel: "counter",
        servedBy: actorId,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: orders.id });
    if (!order) return { ok: false, error: "The order could not be saved." };

    await tx.insert(orderLines).values(
      lines.map((line) => ({
        tenantId: ctx.tenantId,
        orderId: order.id,
        itemId: line.itemId,
        itemName: line.itemName,
        qty: line.qty,
        unitPricePaise: BigInt(line.unitPricePaise),
        taxRateBp: line.taxRateBp,
        sacCode: line.sacCode,
        linePaise: BigInt(line.linePaise),
        taxPaise: BigInt(line.taxPaise),
      })),
    );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action: "order.create",
      entityType: "order",
      entityId: order.id,
      after: {
        locationId: input.locationId,
        memberId: input.memberId ?? null,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          itemName: l.itemName,
          qty: l.qty,
          linePaise: l.linePaise,
          taxPaise: l.taxPaise,
        })),
        totalPaise,
      },
    });

    return { ok: true, orderId: order.id, totalPaise };
  });
}
