// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// Mobile slice — the selected-slot summary keeps the full date, one-hour
// duration and tenant zone visible while the owner changes the slot.
// The rendered RED/GREEN for the gutter and this summary lives in
// docs/design/owner-openpen-20261029/evidence/mobile-red-2.log and
// mobile-rendered-4.log; this case is the focused component regression.

vi.mock("@/lib/actions/bookings", () => ({
  quoteBookingAction: async () => ({ ok: true as const, pricePaise: 50000 }),
  createBookingAction: async () => ({
    ok: false as const,
    error: "not used",
  }),
}));
vi.mock("@/components/cafe-member-picker", () => ({
  CafeMemberPicker: () => <div data-testid="member-picker" />,
}));

import { BookingForm } from "@/components/booking-form";

const TERMINOLOGY = { locale: "en" as const, overrides: {} };

afterEach(cleanup);

it("states the facility, date, one-hour slot and zone, and follows the slot", () => {
  render(
    <BookingForm
      facilities={[
        {
          id: "f-1",
          name: "Main court",
          kind: "court",
          capacity: 4,
          locationId: "loc-1",
          locationName: "Worli Main",
          subUnits: [],
        },
      ]}
      timezone="Asia/Kolkata"
      today="2026-10-29"
      terminology={TERMINOLOGY}
      facilityId="f-1"
      onFacilityChange={vi.fn()}
      date="2026-10-29"
      onDateChange={vi.fn()}
      onCreated={vi.fn()}
    />,
  );

  const summary = screen.getByTestId("booking-slot-summary");
  expect(summary.textContent).toContain("Main court");
  expect(summary.textContent).toContain("29 Oct 2026");
  expect(summary.textContent).toContain("1 hour");
  expect(summary.textContent).toContain("Asia/Kolkata");
  expect(summary.textContent).toContain("Worli Main");

  fireEvent.change(screen.getByTestId("booking-slot"), {
    target: { value: "06:00" },
  });
  expect(summary.textContent).toContain("6:00 am–7:00 am");
});
