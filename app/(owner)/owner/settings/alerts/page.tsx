import { getAbsenceAlertThresholdAction } from "@/lib/actions/absence-alerts";
import { AlertSettingsForm } from "@/components/alert-settings-form";
import { requireOwner } from "@/lib/auth/surface-guard";
import { BackLink } from "@/components/ui/BackLink";

// R.8 — owner surface for the low-attendance alert threshold.
export default async function AlertSettingsPage() {
  await requireOwner();
  const threshold = await getAbsenceAlertThresholdAction();

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/settings" label="Settings" />
      <h1 className="font-display text-[19px] font-semibold">
        Absence alerts
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Coaches see a read-only alert on a member&apos;s profile, and the
        parent link carries one line. Alerts are raised once a week at
        most — three consecutive absences, or attendance below your
        threshold this month.
      </p>
      <div className="mt-4">
        <AlertSettingsForm initialThreshold={threshold} />
      </div>
    </main>
  );
}
