import Link from "next/link";
import { requireOwner } from "@/lib/auth/surface-guard";
import { listPaymentQrsAction } from "@/lib/actions/payment-qrs";
import { PaymentQrManager } from "@/components/payment-qr-manager";

// C-35 — owner surface for payment QRs. Owners and admins manage
// several QRs, each nicknamed; reception reads them on the collect
// screen.

export default async function PaymentQrsPage() {
  await requireOwner();
  const qrs = await listPaymentQrsAction();

  return (
    <main className="px-5 pt-6 pb-8 max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/owner/settings"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Settings
        </Link>
        {" / "}
        payment QRs
      </p>
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Payment QRs
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        The club&apos;s collection QRs. Reception sees these on the
        collect-payment screen; they cannot change them.
      </p>
      <div className="mt-5">
        <PaymentQrManager qrs={qrs} />
      </div>
    </main>
  );
}
