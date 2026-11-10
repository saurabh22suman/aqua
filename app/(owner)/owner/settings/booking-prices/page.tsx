import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listActivitiesAction } from "@/lib/actions/activities";
import { listBookingPriceRulesAction } from "@/lib/actions/booking-price-admin";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { BookingPriceManager } from "@/components/bookings/booking-price-manager";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

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

export default async function BookingPricesPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);

  const [facilities, rules, terminology] = await Promise.all([
    listActivitiesAction(),
    listBookingPriceRulesAction(),
    getTerminologyAction(),
  ]);


  return (
    <OwnerPage className="max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/owner/settings"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Settings
        </Link>
        {" / "}
        booking prices
      </p>
      <PageHeader
        title={<>Booking slot prices</>}
        purpose={<>Set resource slot prices by day and time.</>}
      />
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
