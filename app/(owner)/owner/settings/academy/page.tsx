import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import { AcademyProfileForm } from "@/components/settings/academy-profile-form";
import { getTenantProfileAction } from "@/lib/actions/tenant-profile";
import { requireOwner } from "@/lib/auth/surface-guard";

// PR2-C1 — owner academy profile. The GSTIN here is the one the
// invoice spine snapshots at issue time; fixing a typo no longer
// needs a platform operator.
export default async function AcademySettingsPage() {
  await requireOwner();
  const profile = await getTenantProfileAction();
  if (!profile) notFound();

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/settings" label="Settings" />

      <h1 className="font-display text-[19px] font-semibold">Academy profile</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        The name, currency, time zone and GSTIN the academy bills under.
      </p>

      <div className="mt-6">
        <AcademyProfileForm
          initial={{
            name: profile.name,
            currency: profile.currency,
            timezone: profile.timezone,
            gstin: profile.gstin ?? "",
          }}
        />
      </div>
    </main>
  );
}
