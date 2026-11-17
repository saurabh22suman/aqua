import { and, eq, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { invoices } from "@/db/schema/invoices";
import { orders } from "@/db/schema/orders";
import { payments } from "@/db/schema/payments";
import type { TenantId } from "@/lib/ids";

/** Eligibility is a projection, not authority; writers must hold the invoice lock. */
export type InvoiceCorrectionEligibility = "eligible" | "cafe" | "payment_history" | "unavailable";

export async function invoiceCorrectionEligibilityInTx(
  tx: TenantTx, tenantId: TenantId, invoiceId: string,
): Promise<InvoiceCorrectionEligibility> {
  const [row] = await tx.select({ paidPaise: invoices.paidPaise }).from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId))).limit(1);
  if (!row) return "unavailable";
  const [cafe] = await tx.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.invoiceId, invoiceId))).limit(1);
  if (cafe) return "cafe";
  if (row.paidPaise > 0n) return "payment_history";
  const [history] = await tx.select({ id: payments.id }).from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, invoiceId), sql`${payments.status} in ('captured', 'refunded')`)).limit(1);
  if (history) return "payment_history";
  return "eligible";
}
