import { requireReception } from "@/lib/auth/surface-guard";
import { listBookableFacilitiesAction } from "@/lib/actions/bookings";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { BookingScreen } from "@/components/booking-screen";
import { todayInZone } from "@/lib/time/tz";

// V-04 — reception booking counter. Pick a facility and lane, a date
// and an hourly slot, a member or a named walk-in; the price comes
// from the V-03 resolver and the booking is created with the
// database's overlap guard behind it. Member bookings can be billed
// and collected on the spot; walk-ins stay unbillable in R1.
//
// The page guard fails closed for every other surface. The bottom nav
// stays four items — this screen is reached from Today.

export default async function ReceptionBookingsPage() {
  await requireReception();
  const [facilities, timezone, terminology] = await Promise.all([
    listBookableFacilitiesAction(),
    getTenantTimezoneAction(),
    getTerminologyAction(),
  ]);

  return (
    <main className="px-5 pt-10 pb-8 max-w-lg">
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Bookings
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Reserve a lane or court, or settle a booking that is already on
        the board.
      </p>
      <div className="mt-6">
        <BookingScreen
          facilities={facilities}
          timezone={timezone}
          today={todayInZone(timezone)}
          terminology={terminology}
        />
      </div>
    </main>
  );
}
