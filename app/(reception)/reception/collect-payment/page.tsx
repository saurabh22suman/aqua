import { requireReception } from "@/lib/auth/surface-guard";
import { listPaymentQrsAction } from "@/lib/actions/payment-qrs";
import { CollectPayment } from "@/components/collect-payment";

// C-36 — reception's read-only collect-payment screen: show a QR,
// optionally with the amount pre-filled. No editing on this surface.

export default async function CollectPaymentPage() {
  await requireReception();
  const qrs = (await listPaymentQrsAction()).filter((qr) => qr.isActive);

  return (
    <main className="px-5 pt-10 max-w-lg">
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Collect payment
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Show the payer a QR to scan. Record the payment once it lands.
      </p>

      {qrs.length === 0 ? (
        <p className="mt-6 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
          No payment QR is active. Ask the owner to add one in Settings →
          Payment QRs.
        </p>
      ) : (
        <div className="mt-6">
          <CollectPayment qrs={qrs} />
        </div>
      )}
    </main>
  );
}
