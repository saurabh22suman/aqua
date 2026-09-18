import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { orders, orderLines } from "@/db/schema/orders";
import { invoices } from "@/db/schema/invoices";
import { members, persons } from "@/db/schema/people";
import { locations } from "@/db/schema/locations";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { gstDocumentKind, type GstDocumentKind } from "@/lib/gst";
import type { ActionCtx } from "@/lib/auth/context";
import type { OrderStatus } from "@/db/schema/orders";
import type { InvoiceStatus } from "@/db/schema/invoices";

// K-08 — the itemized café bill, split from the billing-flow service
// (lib/services/cafe-billing.ts) for the 300-line rule. The types +
// readBill live here; both services re-export them so callers keep
// one import surface.

export type OpenCafeOrderRow = {
  orderId: string;
  status: OrderStatus;
  memberId: string | null;
  memberName: string | null;
  locationId: string;
  locationName: string;
  createdAt: string;
  totalPaise: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amountDuePaise: number;
  billable: boolean;
};

export type CafeBillLine = {
  itemName: string;
  qty: number;
  unitPricePaise: number;
  linePaise: number;
  taxRateBp: number;
  taxPaise: number;
};

export type CafeBill = {
  orderId: string;
  status: OrderStatus;
  memberId: string;
  memberName: string;
  locationId: string;
  locationName: string;
  documentKind: GstDocumentKind;
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: InvoiceStatus;
  lines: CafeBillLine[];
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  amountDuePaise: number;
};

export type CafeBillResult =
  | { ok: true; bill: CafeBill; alreadyBilled: boolean }
  | { ok: false; error: string };

// Read the bill for an order that already has an invoice. The maths
// is re-derived from the order's snapshotted lines and verified
// against the issued invoice; a drift throws, it never renders a
// wrong amount due.
export async function readBill(
  ctx: ActionCtx,
  orderId: string,
): Promise<CafeBillResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const orderRows = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, ctx.tenantId)))
      .limit(1);
    const order = orderRows[0];
    if (!order || !locationVisible(access, order.locationId)) {
      return { ok: false, error: "Order not found." };
    }
    if (!order.invoiceId) {
      return { ok: false, error: "This order has no bill yet." };
    }
    if (!order.memberId) {
      return {
        ok: false,
        error: "A walk-in order needs a member before it can be billed.",
      };
    }

    const invoiceRows = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, order.invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    const invoice = invoiceRows[0];
    if (!invoice) return { ok: false, error: "This order has no bill yet." };

    const lineRows = await tx
      .select()
      .from(orderLines)
      .where(
        and(
          eq(orderLines.tenantId, ctx.tenantId),
          eq(orderLines.orderId, order.id),
        ),
      )
      .orderBy(asc(orderLines.id));
    if (lineRows.length === 0) {
      return { ok: false, error: "This order has no lines." };
    }

    const [memberRow] = await tx
      .select({ name: persons.fullName })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(
        and(
          eq(members.id, order.memberId),
          eq(members.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    const [locationRow] = await tx
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, order.locationId))
      .limit(1);

    const lines: CafeBillLine[] = lineRows.map((line) => ({
      itemName: line.itemName,
      qty: line.qty,
      unitPricePaise: Number(line.unitPricePaise),
      linePaise: Number(line.linePaise),
      taxRateBp: line.taxRateBp,
      taxPaise: Number(line.taxPaise),
    }));
    const subtotalPaise = lines.reduce((sum, line) => sum + line.linePaise, 0);
    const taxPaise = lines.reduce((sum, line) => sum + line.taxPaise, 0);
    const totalPaise = subtotalPaise + taxPaise;

    // The bill IS the order snapshot. If the invoice disagrees, fail
    // loudly — never render a total the lines do not support.
    if (
      subtotalPaise !== Number(invoice.subtotalPaise) ||
      taxPaise !== Number(invoice.taxPaise) ||
      totalPaise !== Number(invoice.totalPaise)
    ) {
      throw new Error(
        `Café bill invariant violated for order ${order.id}: lines ${subtotalPaise}+${taxPaise}=${totalPaise} do not match invoice ${invoice.subtotalPaise}+${invoice.taxPaise}=${invoice.totalPaise}.`,
      );
    }
    const amountDuePaise =
      Number(invoice.totalPaise) - Number(invoice.paidPaise);

    return {
      ok: true,
      alreadyBilled: false,
      bill: {
        orderId: order.id,
        status: order.status,
        memberId: order.memberId,
        memberName: memberRow?.name ?? "",
        locationId: order.locationId,
        locationName: locationRow?.name ?? "",
        documentKind: gstDocumentKind(invoice.gstin),
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceStatus: invoice.status as InvoiceStatus,
        lines,
        subtotalPaise,
        taxPaise,
        totalPaise,
        amountDuePaise,
      },
    };
  });
}
