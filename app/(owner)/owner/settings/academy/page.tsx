import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import { AcademyProfileForm } from "@/components/settings/academy-profile-form";
import { getTenantProfileAction } from "@/lib/actions/tenant-profile";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerSectionLinks } from "@/components/owner-ui/owner-section-links";
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
  if (!billing.ok) return <OwnerPage workflow="settings">
    <BackLink href="/owner/settings" label="Settings" />
    <PageHeader title="Club profile & GST" />
    <p role="alert" className="mt-4 text-[14px] text-ink-2">Could not load the club billing default. Please try again.</p>
    <Link href="/owner/settings/academy" className="mt-3 inline-flex min-h-12 items-center text-[var(--accent-ink)] underline">Try again</Link>
  </OwnerPage>;

  return (
    <OwnerPage workflow="settings">
      <BackLink href="/owner/settings" label="Settings" />

      <PageHeader
        title={<>Club profile &amp; GST</>}
        purpose={<>Club-wide identity and billing details for future invoices.</>}
      />

      {/* Two forms, two saves. Saying so prevents a false success after
          editing both and pressing only one button. */}
      <p className="mt-3 max-w-[65ch] text-[13px] leading-relaxed text-ink-2">
        Club identity and billing identity save separately. Check each
        form&apos;s own confirmation after editing both.
      </p>

      <OwnerSectionLinks label="Club profile sections" className="mt-3" sections={[
        { id: "club-profile-identity", label: "Club identity" },
        { id: "club-billing-identity", label: "Billing identity" },
      ]} />
      <div id="club-profile-identity" tabIndex={-1} className="mt-5">
        <AcademyProfileForm
          initial={{
            name: profile.name,
            currency: profile.currency,
            timezone: profile.timezone,
          }}
        />
      </div>
      <div id="club-billing-identity" tabIndex={-1}><FacilityClubBillingForm initial={billing.value} /></div>
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
