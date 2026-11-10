import { requireReception } from "@/lib/auth/surface-guard";
import { PaymentRecordForm } from "@/components/payment-record-form";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";

// C-36 — reception's collect-payment screen. The selected invoice is the
// single amount source: its payment form shows the bill-linked UPI QR and
// records the payment once it lands (PR2-C3). Recording rides the existing
// payments service; the receptionist already holds payments.record. There is
// no separate generic QR/amount panel on this route.
export default async function CollectPaymentPage() {
  await requireReception();
  return (
    <StaffPage className="max-w-xl">
      <StaffPageHeader
        title="Collect payment"
        meta="Show the payer a QR to scan, then record the payment against their invoice."
      />

      <div className="mt-6">
        <PaymentRecordForm />
      </div>
    </StaffPage>
  );
}
