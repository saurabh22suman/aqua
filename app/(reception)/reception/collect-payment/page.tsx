import { requireReception } from "@/lib/auth/surface-guard";
import { listPaymentQrsAction } from "@/lib/actions/payment-qrs";
import { CollectPayment } from "@/components/collect-payment";
import { PaymentRecordForm } from "@/components/payment-record-form";

// C-36 — reception's collect-payment screen: show a QR for the payer
// to scan, and record the payment once it lands (PR2-C3 — the screen
// used to display a QR and nothing else). Recording rides the existing
// payments service; the receptionist already holds payments.record.

export default async function CollectPaymentPage() {
  await requireReception();
  const qrs = (await listPaymentQrsAction()).filter((qr) => qr.isActive);

  return (
    <main className="px-5 pt-10 pb-8 max-w-lg">
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Collect payment
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Show the payer a QR to scan, then record the payment against their
        invoice.
      </p>

      <div className="mt-6 space-y-6">
        {qrs.length === 0 ? (
          <p className="rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
            No payment QR is active. Ask the owner to add one in Settings →
            Payment QRs.
          </p>
        ) : (
          <CollectPayment qrs={qrs} />
        )}

        <PaymentRecordForm />
      </div>
    </main>
  );
}
