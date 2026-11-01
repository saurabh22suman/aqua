import Link from "next/link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listPaymentQrsAction } from "@/lib/actions/payment-qrs";
import { PaymentQrManager } from "@/components/payment-qr-manager";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// C-35 — owner surface for payment QRs. Owners and admins manage
// several QRs, each nicknamed; reception reads them on the collect
// screen.

export default async function PaymentQrsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  const qrs = await listPaymentQrsAction();

  return (
    <OwnerPage className="max-w-2xl">
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
      <PageHeader
        title={<>Payment QR codes</>}
        purpose={<>The club&apos;s collection QRs. Reception sees these on the
        collect-payment screen; they cannot change them.</>}
      />
      <div className="mt-5">
        <PaymentQrManager qrs={qrs} />
      </div>
    </OwnerPage>
  );
}
