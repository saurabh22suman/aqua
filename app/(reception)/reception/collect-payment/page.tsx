import { requireReception } from "@/lib/auth/surface-guard";
import { PaymentRecordForm } from "@/components/payment-record-form";

// C-36 — reception's collect-payment screen. The selected invoice is the
// single amount source: its payment form shows the bill-linked UPI QR and
// records the payment once it lands (PR2-C3). Recording rides the existing
// payments service; the receptionist already holds payments.record. There is
// no separate generic QR/amount panel on this route.

export default async function CollectPaymentPage() {
  await requireReception();
  return (
    <main className="px-5 pt-10 pb-8 max-w-lg">
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Collect payment
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Show the payer a QR to scan, then record the payment against their
        invoice.
      </p>

      <div className="mt-6">
        <PaymentRecordForm />
      </div>
    </main>
  );
}
