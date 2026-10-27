import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { listBookableFacilitiesAction } from "@/lib/actions/bookings";
import { getBookingPriceStatusAction } from "@/lib/actions/booking-price-admin";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { BookingScreen } from "@/components/booking-screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineFeedback } from "@/components/ui/InlineFeedback";
import { todayInZone } from "@/lib/time/tz";
import type { BookableFacility } from "@/lib/services/bookings";

// Batch 6 — the authenticated owner booking desk.
//
// The engine is the one that already exists: the same BookingScreen
// the reception counter was built around (facility → lane → date →
// slot → server quote → member or walk-in → confirm → day board →
// cancel → bill). Nothing here re-implements booking; the page adds
// the owner frame, the price prerequisite and honest states.
//
// Guards: requireOwner (the owner surface) + the bookings.read
// permission + the pool.booking feature entitlement. A tenant without
// the entitlement has no booking surface at all, so the route 404s
// like a made-up path.
//
// The states are deliberately separate: no facilities, no price
// configured, a failed read and a slot conflict each say their own
// thing. A read that fails is never rendered as an empty list.

export default async function OwnerBookingsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "bookings.read");
  if (!hasFeature(ctx, "pool.booking")) notFound();
  // The price screen is management authority (`settings.manage`). A
  // caller who may read bookings but not manage prices is told the
  // fact, not offered a route that would 404 for them.
  const canManagePrices = hasPermission(ctx, "settings.manage");

  const timezone = await getTenantTimezoneAction();
  const today = todayInZone(timezone);
  const terminology = await getTerminologyAction();

  let facilities: BookableFacility[] = [];
  let facilitiesError: string | null = null;
  try {
    facilities = await listBookableFacilitiesAction();
  } catch {
    facilitiesError =
      "The facility list could not be loaded. Reload the page to try again.";
  }

  let activePrices: number | null = null;
  let pricesError: string | null = null;
  try {
    const status = await getBookingPriceStatusAction();
    activePrices = status.active;
  } catch {
    pricesError = "The price list could not be loaded.";
  }

  return (
    <main className="px-5 pt-6 pb-8 max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/owner"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Home
        </Link>
        {" / "}
        bookings
      </p>
      <h1 className="mt-2 font-display text-[19px] font-semibold">Bookings</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Take a booking for a member or a walk-in. The price shown is the
        configured price for that slot; a booking keeps the price it was
        quoted.
        {canManagePrices ? (
          <>
            {" "}
            <Link
              href="/owner/settings/booking-prices"
              className="font-medium underline underline-offset-2"
              data-testid="owner-bookings-manage-prices"
            >
              Manage prices
            </Link>
          </>
        ) : null}
      </p>

      {pricesError ? (
        <div className="mt-4" data-testid="owner-bookings-price-error">
          <InlineFeedback tone="error">{pricesError}</InlineFeedback>
        </div>
      ) : null}

      {activePrices === 0 ? (
        <div className="mt-4" data-testid="owner-bookings-no-price">
          <InlineFeedback tone="neutral">
            No price is configured for any slot yet, so every booking will
            be refused.
            {canManagePrices ? (
              <>
                {" "}
                <Link
                  href="/owner/settings/booking-prices"
                  className="font-medium underline underline-offset-2"
                >
                  Set the prices
                </Link>{" "}
                first.
              </>
            ) : null}
          </InlineFeedback>
        </div>
      ) : null}

      {facilitiesError ? (
        <div className="mt-4" data-testid="owner-bookings-facilities-error">
          <InlineFeedback tone="error">{facilitiesError}</InlineFeedback>
        </div>
      ) : null}

      {facilities.length === 0 && !facilitiesError ? (
        <div className="mt-4 rounded-card border border-line bg-paper">
          <EmptyState
            title="No bookable facilities yet"
            body="A pool, court or studio has to exist before it can be booked. Add one in Settings, then come back."
            action={{ label: "Set up facilities", href: "/owner/settings/activities" }}
          />
        </div>
      ) : null}

      {facilities.length > 0 ? (
        <div className="mt-5">
          <BookingScreen
            facilities={facilities}
            timezone={timezone}
            today={today}
            terminology={terminology}
          />
        </div>
      ) : null}
    </main>
  );
}
