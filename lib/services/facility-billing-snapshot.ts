import { billingAddressSchema, type BillingIssuer } from "@/lib/services/facility-billing-contract";
import type { invoices } from "@/db/schema/invoices";

// Legacy documents have no issuer profile; never reconstruct one from today's settings.
export function invoiceIssuerSnapshot(invoice: typeof invoices.$inferSelect): BillingIssuer | null {
  if (invoice.issuerSnapshotVersion !== 1) return null;
  const address = billingAddressSchema.safeParse(invoice.issuerLegalAddress);
  if (!invoice.issuerLegalName || !invoice.issuerStateCode || !address.success) return null;
  return { legalName: invoice.issuerLegalName, legalAddress: address.data, stateCode: invoice.issuerStateCode, gstin: invoice.gstin };
}
