import { requireReception } from "@/lib/auth/surface-guard";
import { PaymentRecordForm } from "@/components/payment-record-form";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";
import { getInvoiceAction } from "@/lib/actions/invoices";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { PreselectedInvoice } from "@/components/reception/preselected-invoice";
import Link from "next/link";

// C-36 — reception's collect-payment screen. The selected invoice is the
// single amount source: its payment form shows the bill-linked UPI QR and
// records the payment once it lands (PR2-C3). Recording rides the existing
// payments service; the receptionist already holds payments.record. There is
// no separate generic QR/amount panel on this route.
export default async function CollectPaymentPage({ searchParams }: { searchParams?: Promise<{invoice?: string}> }) {
  const ctx = await requireReception();
  const requested = (await searchParams)?.invoice;
  const allowed = hasPermission(ctx, "invoices.read") && hasPermission(ctx, "payments.record") && hasFeature(ctx, "billing");
  const invoice = requested && allowed ? await getInvoiceAction(requested) : null;
  return (
    <StaffPage className="max-w-xl">
      <StaffPageHeader
        title="Collect payment"
        meta="Show the payer a QR to scan, then record the payment against their invoice."
      />

      <div className="mt-6">
        {requested ? invoice ? <PreselectedInvoice initial={invoice} /> : <p role="alert">Invoice is not available for collection. <Link href="/reception/dues" className="underline">Return to dues</Link></p> : <PaymentRecordForm />}
      </div>
    </StaffPage>
  );
}
