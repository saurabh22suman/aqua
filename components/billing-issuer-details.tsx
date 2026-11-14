import type { BillingIssuer } from "@/lib/services/facility-billing-contract";
import { GST_STATE_NAMES } from "@/lib/gst";

// Version-0 documents have no captured issuer profile: show no guessed data.
export function BillingIssuerDetails({ issuer }: { issuer?: BillingIssuer | null }) {
  if (!issuer) return null;
  const address = [issuer.legalAddress.line1, issuer.legalAddress.line2, issuer.legalAddress.city, issuer.legalAddress.postalCode].filter(Boolean).join(", ");
  return (
    <div className="text-[12px] text-ink-2" data-testid="billing-issuer">
      <p>Issued by {issuer.legalName}</p>
      <p>{address} · {GST_STATE_NAMES[issuer.stateCode] ?? issuer.stateCode}</p>
      {issuer.gstin ? <p>GSTIN {issuer.gstin}</p> : <p>Unregistered supplier</p>}
    </div>
  );
}
