import { requireReception } from "@/lib/auth/surface-guard";
import { getReceptionCloseSummaryAction } from "@/lib/actions/reconciliation";
import {
  OWNER_CLOSE_THRESHOLD_PAISE,
  REVIEW_THRESHOLD_PAISE,
} from "@/lib/services/reconciliation";
import { ReceptionCloseDay } from "@/components/reception-close-day";
import { BackLink } from "@/components/ui/BackLink";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";

// M01 — the reception counter's scoped close. Reads ride
// payments.record (the counter grant), never reports.financial; the
// service returns only the caller's assigned locations and today.
// Closing reuses the shared cash-count action; reopening stays with
// the owner.
export default async function ReceptionClosePage() {
  await requireReception();
  const summary = await getReceptionCloseSummaryAction();

  return (
    <StaffPage className="max-w-xl">
      <BackLink href="/reception" label="Today" />
      <StaffPageHeader
        title="Close day"
        meta="Count the cash at your counter and confirm it against today's recorded collections. The owner can reopen a closed day."
      />
      <ReceptionCloseDay
        summary={summary}
        reviewThresholdPaise={REVIEW_THRESHOLD_PAISE}
        ownerCloseThresholdPaise={OWNER_CLOSE_THRESHOLD_PAISE}
      />
    </StaffPage>
  );
}
