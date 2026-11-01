// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign (27 October 2026) — the calendar amendment for the
// booking desk.
//
// The human asked for a calendar experience for bookings as well as
// for batches. These cases pin what that must NOT cost: the board
// stays reachable, a booking opened from the calendar carries the same
// bill and cancel actions the list carries, and a booking keeps its
// price and its place in the day.
//
// The desk reads a DAY at a time through the existing authorised
// action, so a week view is seven of those reads — no new backend.

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  cancelled: [] as string[],
  requestedDates: [] as string[],
  requestedFacilityIds: [] as string[],
  hold: false,
  fail: false,
}));

vi.mock("@/lib/actions/bookings", () => ({
  listBookingsAction: async ({
    date,
    facilityId,
  }: {
    date: string;
    facilityId: string;
  }) => {
    mocks.requestedDates.push(date);
    mocks.requestedFacilityIds.push(facilityId);
    if (mocks.fail) {
      throw new Error("read failed");
    }
    if (mocks.hold) {
      await new Promise(() => {});
    }
    return mocks.rows;
  },
  cancelBookingAction: async ({ bookingId }: { bookingId: string }) => {
    mocks.cancelled.push(bookingId);
    return { ok: true as const };
  },
  requestBookingBillAction: async () => ({
    ok: false as const,
    error: "No bill raised in this test.",
  }),
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

afterEach(() => {
  cleanup();
  mocks.rows = [];
  mocks.cancelled = [];
  mocks.requestedDates = [];
  mocks.requestedFacilityIds = [];
  mocks.hold = false;
  mocks.fail = false;
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

describe("owner booking desk calendar", () => {
  it("shows the bookings on a calendar", async () => {
    mocks.rows = [ROW];
    const { container } = renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    expect(container.querySelector('[data-testid="calendar-grid"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="calendar-event"]')).toBeTruthy();
  });

  it("places a booking at its time and names who it is for", async () => {
    mocks.rows = [ROW];
    const { container } = renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    const block = container.querySelector('[data-testid="calendar-event"]');
    // 16:00 IST — the 06:00 ruler starts ten hours earlier.
    expect(block!.getAttribute("data-top")).toBe("600");
    expect(block!.getAttribute("data-height")).toBe("60");
    expect(block!.textContent).toContain("Rohan Shah");
    expect(block!.textContent).toContain("Main court");
  });

  it("keeps the board reachable", async () => {
    mocks.rows = [ROW];
    const { container } = renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(container.querySelector('[data-testid="booking-day-list"]')).toBeTruthy();
  });

  it("offers the same counter actions from the calendar's detail panel", async () => {
    mocks.rows = [ROW];
    const { container } = renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    const block = container.querySelector<HTMLButtonElement>(
      '[data-testid="calendar-event"]',
    )!;
    fireEvent.click(block);
    const detail = await screen.findByTestId("calendar-detail");
    expect(detail.textContent).toContain("Main court");
    expect(detail.textContent).toContain("₹500");
    expect(
      detail.querySelector('[data-testid="booking-bill-button"]'),
    ).toBeTruthy();
    expect(
      detail.querySelector('[data-testid="booking-cancel-button"]'),
    ).toBeTruthy();
  });

  it("offers a week of bookings, not only the chosen day", async () => {
    mocks.rows = [ROW];
    const { container } = renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    await waitFor(() => {
      expect(
        container.querySelectorAll('[data-testid="calendar-track"]').length,
      ).toBe(7);
    });
  });

  it("reads every day of the week through the existing day read", async () => {
    mocks.rows = [ROW];
    renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    await waitFor(() => {
      expect(mocks.requestedDates.length).toBeGreaterThan(1);
    });
    // Every read is the same authorised day read, scoped to the
    // facility — no new backend call.
    expect(mocks.requestedDates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(
      true,
    );
    expect(mocks.requestedFacilityIds.every((f) => f === "f-1")).toBe(true);
  });

  it("does not show the previous day's rows under a new date", async () => {
    mocks.rows = [ROW];
    const { container } = renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    expect(container.querySelector('[data-testid="calendar-event"]')).toBeTruthy();

    // The owner moves to the next day. Until the new read answers, the
    // old day's rows must not sit under the new heading.
    mocks.hold = true;
    fireEvent.change(screen.getByTestId("booking-date"), {
      target: { value: "2026-10-28" },
    });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="calendar-event"]')).toBeNull();
    });
    expect(screen.getByTestId("booking-loading")).toBeTruthy();
  });

  it("names the days the week shows, not the day that was picked", async () => {
    mocks.rows = [ROW];
    renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    await waitFor(() => {
      const range = screen.getByTestId("calendar-range").textContent ?? "";
      // The week of Monday 26 October 2026 — the label must name the
      // range it shows, not the Tuesday that happens to be picked.
      expect(range).toContain("26 Oct");
      expect(range).toContain("1 Nov");
    });
  });

  it("says a failed read failed, and does not claim the week is empty", async () => {
    mocks.fail = true;
    mocks.rows = [ROW];
    renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    await waitFor(() => {
      expect(screen.getByTestId("booking-read-error")).toBeTruthy();
    });
    expect(document.body.textContent).not.toContain("No bookings on this day");
  });

  it("keeps the board reading the day, not the week", async () => {
    mocks.rows = [ROW];
    renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    await waitFor(() => {
      expect(mocks.requestedDates.length).toBeGreaterThan(1);
    });
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    await waitFor(() => {
      expect(screen.getByTestId("booking-day-list")).toBeTruthy();
    });
    // The board shows the chosen DAY's booking, not the week's.
    const list = screen.getByTestId("booking-day-list");
    expect(list.textContent).toContain("Rohan Shah");
  });

  it("does not present the old answer as ready when the read comes back", async () => {
    // The owner leaves the week and comes back. The week read runs
    // again; until it answers, the desk must not present the PREVIOUS
    // week's rows as current — a cancelled booking would still look
    // live, with its actions.
    mocks.rows = [ROW];
    renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    await waitFor(() => {
      expect(mocks.requestedDates.length).toBeGreaterThan(1);
    });
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    await waitFor(() => {
      expect(screen.getByTestId("booking-day-list")).toBeTruthy();
    });
    mocks.hold = true;
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    await waitFor(() => {
      expect(screen.getByTestId("booking-loading")).toBeTruthy();
    });
    // And the stale row is not on show while the new read is in flight.
    expect(screen.queryByTestId("calendar-event")).toBeNull();
  });

  it("shows the week in the agenda, not a permanent loading state", async () => {
    // The agenda lists the WEEK's bookings, so it reads the week. It
    // must therefore show the week's rows — not sit on a loading
    // state, and not label one day as the range.
    mocks.rows = [ROW];
    renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    fireEvent.click(screen.getByRole("tab", { name: "Agenda" }));
    await waitFor(() => {
      expect(screen.getByTestId("calendar-agenda")).toBeTruthy();
    });
    expect(screen.queryByTestId("booking-loading")).toBeNull();
    const agenda = screen.getByTestId("calendar-agenda");
    expect(agenda.textContent).toContain("Rohan Shah");
    // The range it shows is the week, not the picked day.
    const range = screen.getByTestId("calendar-range").textContent ?? "";
    expect(range).toContain("26 Oct");
    expect(range).toContain("1 Nov");
  });

  it("says the week is empty when the agenda's week has no bookings", async () => {
    mocks.rows = [];
    renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    fireEvent.click(screen.getByRole("tab", { name: "Agenda" }));
    await waitFor(() => {
      expect(screen.getByTestId("calendar-empty")).toBeTruthy();
    });
    // The agenda shows the WEEK, so an empty week is an empty WEEK —
    // never "no bookings on this day".
    expect(document.body.textContent).toContain("No bookings in this week");
    expect(document.body.textContent).not.toContain("No bookings on this day");
  });

  it("reads only the range it is showing", async () => {
    mocks.rows = [ROW];
    renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    // The Day view reads ONE day. The week read must not run behind
    // it: eight authorised reads for one day is waste, and the
    // authorisation story stays the same either way.
    await waitFor(() => {
      expect(mocks.requestedDates.length).toBeGreaterThan(0);
    });
    expect(mocks.requestedDates.length).toBe(1);
  });

  it("reads the week only when the week is on show", async () => {
    mocks.rows = [ROW];
    renderScreen();
    await screen.findByRole("tab", { name: "Calendar" });
    const before = mocks.requestedDates.length;
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    await waitFor(() => {
      expect(mocks.requestedDates.length).toBeGreaterThan(before);
    });
    // The seven days of the week, and no second read of the chosen
    // day for the board.
    expect(mocks.requestedDates.length - before).toBe(7);
  });
});
