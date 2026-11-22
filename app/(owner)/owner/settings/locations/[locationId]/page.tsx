import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { getClubBillingDefaultAction, getSiteBillingSettingAction } from "@/lib/actions/facility-billing";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { FacilityBillingForm } from "@/components/settings/facility-billing-form";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";

export default async function FacilitySettingsPage({ params }: { params: Promise<{ locationId: string }> }) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const { locationId } = await params;
  if (!z.string().uuid().safeParse(locationId).success) notFound();
  const [site, club] = await Promise.all([getSiteBillingSettingAction(locationId), getClubBillingDefaultAction()]);
  if ((!site.ok && (site.code === "not_found" || site.code === "owner_required")) || (!club.ok && (club.code === "not_found" || club.code === "owner_required"))) notFound();
  if (!site.ok || !club.ok) return <OwnerPage>
    <BackLink href="/owner/settings/locations" label="Physical facilities" />
    <PageHeader title="Facility financial settings" />
    <p role="alert" className="mt-4 text-[14px] text-ink-2">Could not load these settings. Please try again.</p>
    <Link href={`/owner/settings/locations/${locationId}`} className="mt-3 inline-flex min-h-12 items-center text-[var(--accent-ink)] underline">Try again</Link>
  </OwnerPage>;
  return <OwnerPage>
    <BackLink href="/owner/settings/locations" label="Physical facilities" />
    <PageHeader title={site.value.locationName} purpose="Financial settings for this physical facility." />
    <FacilityBillingForm initial={site.value} club={club.value} />
  </OwnerPage>;
}
