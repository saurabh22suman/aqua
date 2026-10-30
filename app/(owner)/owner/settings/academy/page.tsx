import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import { AcademyProfileForm } from "@/components/settings/academy-profile-form";
import { getTenantProfileAction } from "@/lib/actions/tenant-profile";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// PR2-C1 — owner academy profile. The GSTIN here is the one the
// invoice spine snapshots at issue time; fixing a typo no longer
// needs a platform operator.
export default async function AcademySettingsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  const profile = await getTenantProfileAction();
  if (!profile) notFound();

  return (
    <OwnerPage>
      <BackLink href="/owner/settings" label="Settings" />

      <PageHeader
        title={<>Academy profile</>}
        purpose={<>Identity and billing details for future invoices.</>}
      />

      <div className="mt-5">
        <AcademyProfileForm
          initial={{
            name: profile.name,
            currency: profile.currency,
            timezone: profile.timezone,
            gstin: profile.gstin ?? "",
          }}
        />
      </div>
    </OwnerPage>
  );
}
