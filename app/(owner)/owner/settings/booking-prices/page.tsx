import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listActivitiesAction } from "@/lib/actions/activities";
import { listBookingPriceRulesAction } from "@/lib/actions/booking-price-admin";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { BookingPriceManager } from "@/components/bookings/booking-price-manager";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { SettingsPrerequisite } from "@/components/settings/settings-states";

// Batch 6 — owner/admin configuration of the booking price catalogue.
//
// Every bookable slot needs a price: without one the resolver refuses
// honestly ("No price is configured for this slot") and no booking can
// be taken. This screen is the prerequisite the reception counter was
// hidden for.
//
// Authority is `settings.manage` — owner/admin. The receptionist role
// holds `settings.read` but not `settings.manage`, so the front desk
// can neither see nor change prices.

export default async function BookingPricesPage({searchParams}: {searchParams?: Promise<{resource?:string; date?:string; slot?:string; facility?:string}>}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const selected = searchParams ? await searchParams : {};
  const returnParams = new URLSearchParams();
  for (const key of ["resource", "date", "slot", "facility"] as const) {
    if (selected[key]) returnParams.set(key, selected[key]);
  }

  const [facilities, rules, terminology] = await Promise.all([
    listActivitiesAction(),
    listBookingPriceRulesAction(),
    getTerminologyAction().then(ownerTerminology),
  ]);


  return (
    <OwnerPage workflow="settings" className="max-w-2xl">
      <BackLink href="/owner/settings" label="Settings" />
      <PageHeader
        title={<>Booking slot prices</>}
        purpose={<>Set resource slot prices by day and time.</>}
      />
      {returnParams.has("resource") ? <Link href={`/owner/bookings?${returnParams}`} className="inline-flex min-h-11 items-center underline">Return to selected booking slot</Link> : null}
      {/* Prices are attached to resources. Without one the catalogue looks
          empty for a reason the owner can fix, so name that reason here. */}
      {facilities.length === 0 ? (
        <SettingsPrerequisite
          title="No sports resources yet"
          body="A booking price belongs to a resource. Add a pool, court or table first, then return here to price its slots."
          actionLabel="Add sports resources"
          actionHref="/owner/settings/activities"
        />
      ) : null}
      <div className="mt-5">
        <BookingPriceManager
          facilities={facilities.map((facility) => ({
            id: facility.id,
            name: facility.name,
            locationName: facility.locationName,
          }))}
          rules={rules}
          terminology={terminology}
        />
      </div>
    </OwnerPage>
  );
}
