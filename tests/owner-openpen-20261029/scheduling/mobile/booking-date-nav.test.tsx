// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// Bookings date/nav mobile regression: the field is the shared day-first
// DateField (ISO state), an invalid complete date clears the bookable
// date instead of leaving the previous one, and the phone nav keeps a
// full accessible name while showing a short visible label.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/bookings", () => ({
  listBookingsAction: async () => [],
  quoteBookingAction: async () => ({ ok: true as const, pricePaise: 50000 }),
  createBookingAction: async () => ({ ok: false as const, error: "no" }),
  cancelBookingAction: async () => ({ ok: true as const }),
  requestBookingBillAction: async () => ({ ok: false as const, error: "no" }),
}));
vi.mock("@/components/cafe-member-picker", () => ({
  CafeMemberPicker: () => <div data-testid="member-picker" />,
}));

import { BookingScreen } from "@/components/booking-screen";

const FACILITY = {
  id: "f-1",
  name: "Main court",
  kind: "court",
  capacity: 4,
  locationId: "loc-1",
  locationName: "Worli Main",
  subUnits: [],
};

afterEach(cleanup);

function renderScreen() {
  return render(
    <BookingScreen
      facilities={[FACILITY]}
      timezone="Asia/Kolkata"
      today="2026-10-29"
      terminology={{ locale: "en", overrides: {} }}
    />,
  );
}

it("uses the day-first shared DateField with ISO state unchanged", () => {
  renderScreen();
  const date = screen.getByTestId("booking-date") as HTMLInputElement;
  expect(date.type).toBe("text");
  expect(date.value).toBe("29/10/2026");
});

it("clears the bookable date when the visible date is impossible", async () => {
  renderScreen();
  const date = screen.getByTestId("booking-date");
  fireEvent.change(date, { target: { value: "31/02/2026" } });
  expect((await screen.findAllByText(/Choose a valid date/)).length).toBeGreaterThan(0);
  expect(screen.queryByText(/29 Oct 2026/)).toBeNull();
});

it("keeps full accessible names on the phone day navigation", () => {
  renderScreen();
  const previous = screen.getByRole("button", { name: "Previous day" });
  const next = screen.getByRole("button", { name: "Next day" });
  expect(previous.getAttribute("aria-label")).toBe("Previous day");
  expect(next.getAttribute("aria-label")).toBe("Next day");
});
