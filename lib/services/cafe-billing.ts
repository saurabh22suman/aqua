import { and, asc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { orders, orderLines } from "@/db/schema/orders";
import { invoices } from "@/db/schema/invoices";
import { members, persons } from "@/db/schema/people";
import { locations } from "@/db/schema/locations";
import {
  locationPredicate,
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { finalizeOrder } from "@/lib/services/orders-billing";
import { readBill } from "@/lib/services/cafe-bill-view";
import type { ActionCtx } from "@/lib/auth/context";
import type {
  CafeBillResult,
  OpenCafeOrderRow,
} from "@/lib/services/cafe-bill-view";

// K-08 — the reception café billing flow (the half that lists and
// bills). Billing happens only at reception, like membership billing:
// the receptionist picks an OPEN order, requests the bill —
// finalizeOrder issues the invoice if it has not been issued yet —
// and the itemized bill (cafe-bill-view.ts) shows the amount due
// before the existing payment panel collects it.
//
// "Open" means: placed or served (not billed yet), or billed with an
// invoice that is neither void nor fully paid. A walk-in order lists
// (so staff can see it) but stays unbillable: the invoice spine needs
// a member, and there is deliberately no anonymous path.

export * from "./cafe-bill-view";

export const listOpenCafeOrdersInput = z.object({
  locationId: z.string().uuid().optional(),
});

export type ListOpenCafeOrdersInput = z.input<typeof listOpenCafeOrdersInput>;

export async function listOpenCafeOrders(
  ctx: ActionCtx,
  raw: unknown = {},
): Promise<OpenCafeOrderRow[]> {
  const parsed = listOpenCafeOrdersInput.safeParse(raw);
  if (!parsed.success) return [];
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (input.locationId && !locationVisible(access, input.locationId)) {
      return [];
    }

    const predicates = [
      eq(orders.tenantId, ctx.tenantId),
      or(
        inArray(orders.status, ["placed", "served"] as const),
        and(
          eq(orders.status, "billed"),
          ne(invoices.status, "void"),
          lt(invoices.paidPaise, invoices.totalPaise),
        ),
      )!,
    ];
    if (input.locationId) {
      predicates.push(eq(orders.locationId, input.locationId));
    }
    const scope = locationPredicate(orders.locationId, access);
    if (scope) predicates.push(scope);

    const rows = await tx
      .select({
        order: orders,
        invoice: invoices,
        memberName: persons.fullName,
        locationName: locations.name,
      })
      .from(orders)
      .leftJoin(
        invoices,
        and(
          eq(invoices.id, orders.invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
        ),
      )
      .leftJoin(
        members,
        and(
          eq(members.id, orders.memberId),
          eq(members.tenantId, ctx.tenantId),
        ),
      )
      .leftJoin(persons, eq(persons.id, members.personId))
      .innerJoin(locations, eq(locations.id, orders.locationId))
      .where(and(...predicates))
      .orderBy(asc(orders.createdAt), asc(orders.id));
    if (rows.length === 0) return [];

    const totals = await tx
      .select({
        orderId: orderLines.orderId,
        totalPaise: sql<string>`sum(${orderLines.linePaise} + ${orderLines.taxPaise})::text`,
      })
      .from(orderLines)
      .where(
        and(
          eq(orderLines.tenantId, ctx.tenantId),
          inArray(
            orderLines.orderId,
            rows.map((row) => row.order.id),
          ),
        ),
      )
      .groupBy(orderLines.orderId);
    const totalByOrder = new Map(
      totals.map((row) => [row.orderId, Number(row.totalPaise)]),
    );

    return rows.map((row) => {
      const billed = row.order.invoiceId !== null && row.invoice !== null;
      const totalPaise = billed
        ? Number(row.invoice!.totalPaise)
        : (totalByOrder.get(row.order.id) ?? 0);
      const amountDuePaise = billed
        ? Number(row.invoice!.totalPaise) - Number(row.invoice!.paidPaise)
        : totalPaise;
      return {
        orderId: row.order.id,
        status: row.order.status,
        memberId: row.order.memberId,
        memberName: row.memberName,
        locationId: row.order.locationId,
        locationName: row.locationName,
        createdAt: row.order.createdAt.toISOString(),
        totalPaise,
        invoiceId: row.order.invoiceId,
        invoiceNumber: row.invoice?.invoiceNumber ?? null,
        amountDuePaise,
        billable: row.order.memberId !== null,
      };
    });
  });
}

// Request the bill: finalizeOrder issues the invoice if this order has
// none yet (reusing the K-03 bridge, including its walk-in refusal),
// then read the itemized bill back. A second request returns the same
// invoice with alreadyBilled = true.
export async function requestCafeBill(
  ctx: ActionCtx,
  orderId: string,
): Promise<CafeBillResult> {
  const parsed = z.string().uuid().safeParse(orderId);
  if (!parsed.success) return { ok: false, error: "Invalid order." };

  const existing = await withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select({ invoiceId: orders.invoiceId, locationId: orders.locationId })
      .from(orders)
      .where(and(eq(orders.id, parsed.data), eq(orders.tenantId, ctx.tenantId)))
      .limit(1);
    const order = rows[0];
    if (!order || !locationVisible(access, order.locationId)) return null;
    return order;
  });
  if (!existing) return { ok: false, error: "Order not found." };

  let alreadyBilled = existing.invoiceId !== null;
  if (!existing.invoiceId) {
    const finalized = await finalizeOrder(ctx, parsed.data);
    if (!finalized.ok) {
      // A concurrent request may have billed the order first. If an
      // invoice now exists, fall through and read it; otherwise the
      // refusal is the answer (e.g. the walk-in case).
      const raced = await withTenant(ctx.tenantId, async (tx) => {
        const rows = await tx
          .select({ invoiceId: orders.invoiceId })
          .from(orders)
          .where(
            and(eq(orders.id, parsed.data), eq(orders.tenantId, ctx.tenantId)),
          )
          .limit(1);
        return rows[0]?.invoiceId ?? null;
      });
      if (!raced) return { ok: false, error: finalized.error };
      alreadyBilled = true;
    }
  }

  const bill = await readBill(ctx, parsed.data);
  if (!bill.ok) return bill;
  return { ok: true, bill: bill.bill, alreadyBilled };
}
