import { requireReception } from "@/lib/auth/surface-guard";
import { getReceptionCloseSummaryAction } from "@/lib/actions/reconciliation";
import {
  OWNER_CLOSE_THRESHOLD_PAISE,
  REVIEW_THRESHOLD_PAISE,
} from "@/lib/services/reconciliation";
import { ReceptionCloseDay } from "@/components/reception-close-day";
import { BackLink } from "@/components/ui/BackLink";

// M01 — the reception counter's scoped close. Reads ride
// payments.record (the counter grant), never reports.financial; the
// service returns only the caller's assigned locations and today.
// Closing reuses the shared cash-count action; reopening stays with
// the owner.

export default async function ReceptionClosePage() {
  await requireReception();
  const summary = await getReceptionCloseSummaryAction();

  return (
    <main className="px-5 pt-10 pb-8 max-w-lg">
      <BackLink href="/reception" label="Today" />
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Close day
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Count the cash at your counter and confirm it against today&apos;s
        recorded collections. The owner can reopen a closed day.
      </p>
      <ReceptionCloseDay
        summary={summary}
        reviewThresholdPaise={REVIEW_THRESHOLD_PAISE}
        ownerCloseThresholdPaise={OWNER_CLOSE_THRESHOLD_PAISE}
      />
    </main>
  );
}
