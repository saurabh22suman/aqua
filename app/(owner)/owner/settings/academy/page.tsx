import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import { AcademyProfileForm } from "@/components/settings/academy-profile-form";
import { getTenantProfileAction } from "@/lib/actions/tenant-profile";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { getClubBillingDefaultAction } from "@/lib/actions/facility-billing";
import { FacilityClubBillingForm } from "@/components/settings/facility-club-billing-form";

// PR2-C1 — owner academy profile. The GSTIN here is the one the
// invoice spine snapshots at issue time; fixing a typo no longer
// needs a platform operator.
export default async function AcademySettingsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const profile = await getTenantProfileAction();
  if (!profile) notFound();
  const billing = await getClubBillingDefaultAction();
  if (!billing.ok && (billing.code === "owner_required" || billing.code === "not_found")) notFound();
  if (!billing.ok) return <OwnerPage>
    <BackLink href="/owner/settings" label="Settings" />
    <PageHeader title="Club profile & GST" />
    <p role="alert" className="mt-4 text-[14px] text-ink-2">Could not load the club billing default. Please try again.</p>
    <Link href="/owner/settings/academy" className="mt-3 inline-flex min-h-12 items-center text-[var(--accent-ink)] underline">Try again</Link>
  </OwnerPage>;

  return (
    <OwnerPage>
      <BackLink href="/owner/settings" label="Settings" />

      <PageHeader
        title={<>Club profile &amp; GST</>}
        purpose={<>Club-wide identity and billing details for future invoices.</>}
      />

      <div className="mt-5">
        <AcademyProfileForm
          initial={{
            name: profile.name,
            currency: profile.currency,
            timezone: profile.timezone,
          }}
        />
      </div>
      <FacilityClubBillingForm initial={billing.value} />
      <div className="mt-4 flex flex-wrap gap-x-5">
        <Link href="/owner/settings/plans" className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">
          Membership plan prices
        </Link>
        <Link href="/owner/settings/booking-prices" className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">
          Booking slot prices
        </Link>
      </div>
    </OwnerPage>
  );
}
