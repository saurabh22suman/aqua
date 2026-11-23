import { requireReception } from "@/lib/auth/surface-guard";
import { PaymentRecordForm } from "@/components/payment-record-form";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";
import { getInvoiceAction } from "@/lib/actions/invoices";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { PreselectedInvoice } from "@/components/reception/preselected-invoice";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";

// C-36 — reception's collect-payment screen. The selected invoice is the
// single amount source: its payment form shows the bill-linked UPI QR and
// records the payment once it lands (PR2-C3). Recording rides the existing
// payments service; the receptionist already holds payments.record. There is
// no separate generic QR/amount panel on this route.
export default async function CollectPaymentPage({ searchParams }: { searchParams?: Promise<{invoice?: string}> }) {
  const ctx = await requireReception();
  const requested = (await searchParams)?.invoice;
  const allowed = hasPermission(ctx, "invoices.read") && hasPermission(ctx, "payments.record") && hasFeature(ctx, "billing");
  const lookup = requested && allowed
    ? await getInvoiceAction(requested).then((invoice) => ({ invoice, failed: false }), () => ({ invoice: null, failed: true }))
    : { invoice: null, failed: false };
  return (
    <StaffPage className="max-w-xl">
      <StaffPageHeader
        title="Collect payment"
        meta="Confirm payment before recording it."
      />

      <div className="mt-6">
        {lookup.invoice ? <PreselectedInvoice initial={lookup.invoice} /> : requested || !allowed ? (
          <section className="space-y-3 rounded-card border border-line bg-paper p-4">
            <p role="alert" className="text-sm">
              {lookup.failed ? "Could not load the invoice. Check your connection and try again." : "Invoice is not available for collection."}
            </p>
            <div className="flex flex-wrap gap-2">
              {lookup.failed && requested ? <a href={`/reception/collect-payment?invoice=${encodeURIComponent(requested)}`} aria-label="Retry invoice lookup" className={buttonClasses({ variant: "primary", size: "sm" })}>Retry</a> : null}
              {allowed ? <Link href="/reception/collect-payment" aria-label="Find another invoice" className={buttonClasses({ size: "sm" })}>Find another</Link> : null}
              <Link href="/reception/dues" aria-label="Return to dues" className={buttonClasses({ variant: "ghost", size: "sm" })}>Dues</Link>
            </div>
          </section>
        ) : <PaymentRecordForm />}
      </div>
    </StaffPage>
  );
}
