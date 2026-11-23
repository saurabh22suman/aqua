import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listPaymentQrsAction } from "@/lib/actions/payment-qrs";
import { PaymentQrManager } from "@/components/payment-qr-manager";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";

// C-35 — owner surface for payment QRs. Owners and admins manage
// several QRs, each nicknamed; reception reads them on the collect
// screen.

export default async function PaymentQrsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const qrs = await listPaymentQrsAction();

  return (
    <OwnerPage workflow="settings" className="max-w-2xl">
      <BackLink href="/owner/settings" label="Settings" />
      <PageHeader
        title={<>Payment QR codes</>}
        purpose={<>The club&apos;s collection QRs. Reception sees these on the
        collect-payment screen; they cannot change them.</>}
      />
      <div className="mt-5">
        <PaymentQrManager qrs={qrs} taskSheet={ctx.roleKey === "owner"} />
      </div>
    </OwnerPage>
  );
}
