import { z } from "zod";
import { GSTIN_RE, GST_STATE_NAMES } from "@/lib/gst";
import { billingAddressSchema, type BillingIssuer } from "@/lib/services/facility-billing-contract";

type InvoiceIssuer = {
  issuerSnapshotVersion: number;
  issuerLegalName: string | null;
  issuerLegalAddress: unknown;
  issuerStateCode: string | null;
  issuerRegistrationMode: string | null;
  gstin: string | null;
};

const snapshotSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  legalAddress: billingAddressSchema,
  stateCode: z.string().refine((code) => code in GST_STATE_NAMES),
  gstin: z.string().regex(GSTIN_RE).nullable(),
});

/** Missing/corrupt current snapshots never fall back to today's mutable club profile. */
export function receiptIssuer(invoice: InvoiceIssuer): BillingIssuer | null {
  if (invoice.issuerSnapshotVersion === 0) return null;
  const parsed = snapshotSchema.safeParse({
    legalName: invoice.issuerLegalName,
    legalAddress: invoice.issuerLegalAddress,
    stateCode: invoice.issuerStateCode,
    gstin: invoice.gstin,
  });
  if (invoice.issuerSnapshotVersion !== 1 || !parsed.success) {
    throw new Error("The saved invoice issuer is incomplete.");
  }
  const issuer = parsed.data;
  const registered = invoice.issuerRegistrationMode === "registered" && issuer.gstin !== null;
  const unregistered = invoice.issuerRegistrationMode === "unregistered" && issuer.gstin === null;
  if ((!registered && !unregistered) || (issuer.gstin && !issuer.gstin.startsWith(issuer.stateCode))) {
    throw new Error("The saved invoice issuer is inconsistent.");
  }
  return issuer;
}
