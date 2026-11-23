import { and, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import type { PaymentIntentKind } from "@/db/schema/payment-intents";
import { invoices, type InvoiceStatus } from "@/db/schema/invoices";
import { payments } from "@/db/schema/payments";
import type { TenantId } from "@/lib/ids";

// F01 — the same-layer target lookup shared by prepare, recovery and
// cancel. Split out of lib/services/payment-intents.ts so the prepare
// module stays under the repo's 300-line guideline; no scope, authority
// or query semantics change.

export type PaymentIntentTarget = {
  locationId: string;
  invoiceId: string | null;
  invoiceStatus: InvoiceStatus | null;
};

export async function loadTarget(
  tx: TenantTx,
  tenantId: TenantId,
  kind: PaymentIntentKind,
  targetId: string,
): Promise<PaymentIntentTarget | null> {
  if (kind === "payment") {
    const rows = await tx
      .select({ locationId: invoices.locationId, status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.id, targetId), eq(invoices.tenantId, tenantId)))
      .limit(1);
    const invoice = rows[0];
    if (!invoice) return null;
    return {
      locationId: invoice.locationId,
      invoiceId: targetId,
      invoiceStatus: invoice.status as InvoiceStatus,
    };
  }

  const rows = await tx
    .select({
      locationId: payments.locationId,
      invoiceId: payments.invoiceId,
    })
    .from(payments)
    .where(and(eq(payments.id, targetId), eq(payments.tenantId, tenantId)))
    .limit(1);
  const payment = rows[0];
  if (!payment) return null;

  let invoiceStatus: InvoiceStatus | null = null;
  if (payment.invoiceId) {
    const invoiceRows = await tx
      .select({ status: invoices.status })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, payment.invoiceId),
          eq(invoices.tenantId, tenantId),
        ),
      )
      .limit(1);
    invoiceStatus =
      (invoiceRows[0]?.status as InvoiceStatus | undefined) ?? null;
  }
  return {
    locationId: payment.locationId,
    invoiceId: payment.invoiceId,
    invoiceStatus,
  };
}
