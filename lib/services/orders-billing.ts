import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { orders, orderLines } from "@/db/schema/orders";
import { payments } from "@/db/schema/payments";
import { invoices } from "@/db/schema/invoices";
import { writeAudit } from "@/lib/audit/write";
import { issueInvoiceInTx } from "@/lib/services/invoice-issue";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { todayInZone } from "@/lib/time/tz";
import { tenants } from "@/db/schema/tenants";
import {
  lockedOrder,
  uuid,
  type FinalizeOrderResult,
  type VoidOrderResult,
} from "@/lib/services/orders-core";
import type { ActionCtx } from "@/lib/auth/context";

// K-03 — the café → invoice bridge and the void path. See
// lib/services/orders.ts for the module's public surface; this file is
// the billing half, split out to keep every file under the 300-line
// rule. finalizeOrder issues exactly one invoice (source 'cafe') from
// the order's snapshotted lines and links it; voidOrder is terminal,
// keeps the lines, and refuses while a captured payment exists.

export async function finalizeOrder(
  ctx: ActionCtx,
  orderId: string,
): Promise<FinalizeOrderResult> {
  const parsed = uuid.safeParse(orderId);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const order = await lockedOrder(tx, ctx.tenantId, parsed.data);
    if (!order || !locationVisible(access, order.locationId)) {
      return { ok: false, error: "Order not found." };
    }
    if (order.status === "voided") {
      return { ok: false, error: "This order is void." };
    }
    if (order.status === "billed") {
      return { ok: false, error: "This order is already billed." };
    }
    // The invoice spine requires a member (invoices.member_id NOT
    // NULL). A walk-in can be recorded but must be attached to a
    // member before it can carry a legal document.
    if (!order.memberId) {
      return {
        ok: false,
        error: "A walk-in order needs a member before it can be billed.",
      };
    }

    const lineRows = await tx
      .select()
      .from(orderLines)
      .where(
        and(
          eq(orderLines.orderId, order.id),
          eq(orderLines.tenantId, ctx.tenantId),
        ),
      );
    if (lineRows.length === 0) {
      return { ok: false, error: "This order has no lines." };
    }

    const [tenantRow] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const issuedOn = todayInZone(tenantRow?.timezone ?? "Asia/Kolkata");

    const issued = await issueInvoiceInTx(
      tx,
      {
        tenantId: ctx.tenantId,
        memberId: order.memberId,
        locationId: order.locationId,
        issuedOn,
        dueOn: issuedOn,
        source: "cafe",
        lines: lineRows.map((line) => ({
          description: `${line.qty} × ${line.itemName}`,
          amountPaise: Number(line.linePaise),
          sacCode: line.sacCode,
          taxRateBp: line.taxRateBp,
        })),
      },
      actorId,
    );
    if (!issued.ok) return { ok: false, error: issued.error };

    await tx
      .update(orders)
      .set({
        invoiceId: issued.invoiceId,
        status: "billed",
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, order.id), eq(orders.tenantId, ctx.tenantId)));

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action: "order.bill",
      entityType: "order",
      entityId: order.id,
      before: { status: order.status },
      after: {
        status: "billed",
        invoiceId: issued.invoiceId,
        invoiceNumber: issued.invoiceNumber,
        totalPaise: issued.totalPaise,
      },
    });

    return {
      ok: true,
      invoiceId: issued.invoiceId,
      invoiceNumber: issued.invoiceNumber,
    };
  });
}

export async function voidOrder(
  ctx: ActionCtx,
  orderId: string,
  reason: string,
): Promise<VoidOrderResult> {
  const orderParsed = uuid.safeParse(orderId);
  const reasonParsed = z.string().trim().min(3).max(300).safeParse(reason);
  if (!orderParsed.success) return { ok: false, error: "Invalid order." };
  if (!reasonParsed.success) {
    return { ok: false, error: "Give a reason (3-300 characters)." };
  }
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const order = await lockedOrder(tx, ctx.tenantId, orderParsed.data);
    if (!order || !locationVisible(access, order.locationId)) {
      return { ok: false, error: "Order not found." };
    }
    if (order.status === "voided") {
      return { ok: false, error: "This order is already void." };
    }

    // Refund path first: a captured payment must be handled before the
    // order can be voided. Never row-edit a paid record.
    if (order.invoiceId) {
      const captured = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, ctx.tenantId),
            eq(payments.invoiceId, order.invoiceId),
            eq(payments.status, "captured"),
          ),
        )
        .limit(1);
      if (captured.length > 0) {
        return {
          ok: false,
          error:
            "A payment is recorded against this order's invoice; void the payment path first.",
        };
      }
    }

    const now = new Date();
    if (order.invoiceId) {
      await tx
        .update(invoices)
        .set({ status: "void", updatedBy: actorId, updatedAt: now })
        .where(
          and(
            eq(invoices.id, order.invoiceId),
            eq(invoices.tenantId, ctx.tenantId),
          ),
        );
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorId,
        requestId: ctx.requestId ?? null,
        action: "invoice.void",
        entityType: "invoice",
        entityId: order.invoiceId,
        after: { status: "void", reason: reasonParsed.data, source: "cafe" },
      });
    }

    await tx
      .update(orders)
      .set({
        status: "voided",
        voidReason: reasonParsed.data,
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(and(eq(orders.id, order.id), eq(orders.tenantId, ctx.tenantId)));

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action: "order.void",
      entityType: "order",
      entityId: order.id,
      before: { status: order.status },
      after: {
        status: "voided",
        reason: reasonParsed.data,
        invoiceId: order.invoiceId,
      },
    });

    return { ok: true };
  });
}
