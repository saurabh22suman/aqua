import { getAbsenceAlertThresholdAction } from "@/lib/actions/absence-alerts";
import { AlertSettingsForm } from "@/components/alert-settings-form";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { BackLink } from "@/components/ui/BackLink";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// R.8 — owner surface for the low-attendance alert threshold.
export default async function AlertSettingsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  const threshold = await getAbsenceAlertThresholdAction();

  return (
    <OwnerPage>
      <BackLink href="/owner/settings" label="Settings" />
      <PageHeader
        title={<>Absence alerts</>}
        purpose={<>Coaches see a read-only alert on a member&apos;s profile, and the parent
        link carries one line. Alerts are raised once a week at most.</>}
      />
      <div className="mt-5">
        <AlertSettingsForm initialThreshold={threshold} />
      </div>
    </OwnerPage>
  );
}
