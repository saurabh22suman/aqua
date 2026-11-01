// @vitest-environment jsdom
//
// The booking screen's FIRST LOAD (31 October 2026).
//
// The measured production RED: `/owner/bookings` carries 151 kB of
// first-load JS against the 150 kB budget (DESIGN.md §5), and the build
// fails on it. Every other route is inside the budget.
//
// The bill panel and the receipt are imported EAGERLY by the booking
// screen, but they are drawn only once a bill exists — and a bill is
// raised by the counter, long after the screen is on. So the two are
// loaded ON DEMAND, the way the product already loads the leave
// request form and a member's invoice rows: the screen keeps its first
// load small, and the bill flow itself is unchanged — the amount is
// still shown, the payment is still collected by hand, and the receipt
// is still shown afterwards.
//
// The assertions here are the CONTRACT, not the measurement: the real
// bundle number is the coordinator's build. The runtime case proves the
// deferred panel still arrives with the amount the counter must read.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  bill: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/actions/bookings", () => ({
  listBookingsAction: async () => mocks.rows,
  cancelBookingAction: async () => ({ ok: true as const }),
  requestBookingBillAction: async () =>
    mocks.bill
      ? { ok: true as const, bill: mocks.bill }
      : { ok: false as const, error: "No bill raised in this test." },
}));

vi.mock("@/components/cafe-member-picker", () => ({
  CafeMemberPicker: () => <div data-testid="member-picker" />,
}));

import { BookingScreen } from "@/components/booking-screen";

const ROW = {
  bookingId: "b-1",
  facilityId: "f-1",
  facilityName: "Main court",
  subUnitId: null,
  subUnitName: null,
  locationId: "loc-1",
  locationName: "Worli",
  memberId: "m-1",
  memberName: "Rohan Shah",
  walkInName: null,
  startsAt: "2026-10-27T10:30:00.000Z",
  endsAt: "2026-10-27T11:30:00.000Z",
  status: "confirmed",
  pricePaise: 50000,
  invoiceId: null,
  invoiceNumber: null,
  amountDuePaise: 0,
  billable: true,
};

const BILL = {
  invoiceId: "inv-1",
  invoiceNumber: "INV-1",
  memberName: "Rohan Shah",
  documentKind: "invoice",
  facilityName: "Main court",
  subUnitName: null,
  startsAt: "2026-10-27T10:30:00.000Z",
  endsAt: "2026-10-27T11:30:00.000Z",
  lineDescription: "Court hire",
  subtotalPaise: 50000,
  taxPaise: 0,
  totalPaise: 50000,
  amountDuePaise: 50000,
};

afterEach(() => {
  cleanup();
  mocks.rows = [];
  mocks.bill = null;
});

function renderScreen() {
  return render(
    <BookingScreen
      facilities={[
        {
          id: "f-1",
          name: "Main court",
          kind: "court",
          capacity: 4,
          locationId: "loc-1",
          locationName: "Worli",
          subUnits: [],
        },
      ]}
      timezone="Asia/Kolkata"
      today="2026-10-27"
      terminology={{ locale: "en", overrides: {} }}
    />,
  );
}

describe("the booking screen's first load", () => {
  it("still shows the bill and the amount due once it is raised", async () => {
    mocks.rows = [ROW];
    mocks.bill = BILL;
    renderScreen();

    await screen.findByRole("tab", { name: "Calendar" });
    const block = document.querySelector<HTMLElement>(
      '[data-testid="calendar-event"]',
    );
    expect(block, "the booking is not on the calendar").toBeTruthy();
    fireEvent.click(block!);
    const detail = await screen.findByTestId("calendar-detail");
    const billButton = detail.querySelector<HTMLButtonElement>(
      '[data-testid="booking-bill-button"]',
    );
    expect(billButton, "the booking carries no bill action").toBeTruthy();

    fireEvent.click(billButton!);

    // The panel is loaded on demand, so the first request for it waits
    // for the chunk; the counter sees a "Loading bill…" line until then.
    const panel = await screen.findByTestId(
      "booking-bill",
      {},
      { timeout: 10_000 },
    );
    expect(panel.textContent).toContain("INV-1");
    expect(
      panel.querySelector('[data-testid="booking-amount-due"]')?.textContent,
      "the amount due is not on the bill",
    ).toContain("500");
  });
});
