import Link from "next/link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listActivitiesAction } from "@/lib/actions/activities";
import { listBookingPriceRulesAction } from "@/lib/actions/booking-price-admin";
import { BookingPriceManager } from "@/components/bookings/booking-price-manager";

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

  const [facilities, rules] = await Promise.all([
    listActivitiesAction(),
    listBookingPriceRulesAction(),
  ]);

  return (
    <main className="px-5 pt-6 pb-8 max-w-2xl">
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
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Booking prices
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        What a slot costs. A booking takes the price that matches its day
        and time; a booking already taken keeps the price it was quoted.
      </p>
      <div className="mt-5">
        <BookingPriceManager
          facilities={facilities.map((facility) => ({
            id: facility.id,
            name: facility.name,
            locationName: facility.locationName,
          }))}
          rules={rules}
        />
      </div>
    </main>
  );
}
