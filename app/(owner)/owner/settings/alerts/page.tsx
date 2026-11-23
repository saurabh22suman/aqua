import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { getAbsenceAlertThresholdAction } from "@/lib/actions/absence-alerts";
import { AlertSettingsForm } from "@/components/alert-settings-form";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { BackLink } from "@/components/ui/BackLink";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsReadError } from "@/components/settings/settings-states";

// R.8 — owner surface for the low-attendance alert threshold.
export default async function AlertSettingsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const threshold = await getAbsenceAlertThresholdAction().catch(() => null);
  if (threshold === null) {
    // A read failure is not a threshold of zero: keep the form closed and
    // offer the same route again rather than showing a value the academy
    // never chose.
    return (
      <OwnerPage workflow="settings">
        <BackLink href="/owner/settings/configuration#notifications" label="Academy rules" />
        <PageHeader title={<>Absence alerts</>} />
        <SettingsReadError
          message="Could not load the absence-alert threshold. Nothing was changed."
          retryHref="/owner/settings/alerts"
        />
      </OwnerPage>
    );
  }

  return (
    <OwnerPage workflow="settings">
      <BackLink href="/owner/settings/configuration#notifications" label="Academy rules" />
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
