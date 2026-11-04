// @vitest-environment jsdom
//
// Owner light · Operations lane (3 November 2026) — the walk-in wording.
//
// The booking desk told the owner "R1" in three places: the walk-in field
// hint, the confirmation notice after a walk-in is booked, and the walk-in
// row on the day board. "R1" is an internal release label; on a customer's
// screen it reads as a broken reference and it hides the rule that really
// applies — a walk-in IS recorded, but it cannot be billed.
//
// These cases render the REAL components and assert the visible wording
// only. The walk-in guard is unchanged: the desk still records the walk-in,
// a walk-in row still carries NO bill action, and a member booking still
// says nothing about billing limits.
//
// Owner: operations lane
// Scope: booking-form + booking-day-list copy.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/actions/bookings", () => ({
  quoteBookingAction: async () => ({
    ok: true as const,
    pricePaise: 50000,
    ruleLabel: "Standard",
  }),
  createBookingAction: async (input: Record<string, unknown>) => {
    mocks.created.push(input);
    return { ok: true as const, bookingId: "b-1", pricePaise: 50000 };
  },
}));

vi.mock("@/components/cafe-member-picker", () => ({
  CafeMemberPicker: () => <div data-testid="member-picker" />,
}));

import { BookingForm } from "@/components/booking-form";
import { BookingDayList } from "@/components/booking-day-list";
import type { BookingDayRow } from "@/lib/services/bookings";

afterEach(() => {
  cleanup();
  mocks.created.length = 0;
});

const FACILITIES = [
  {
    id: "f-1",
    name: "Main court",
    kind: "court",
    capacity: 4,
    locationId: "loc-1",
    locationName: "Worli",
    subUnits: [] as Array<{ id: string; name: string }>,
  },
];

const WALK_IN_ROW: BookingDayRow = {
  bookingId: "b-1",
  facilityId: "f-1",
  facilityName: "Main court",
  subUnitId: null,
  subUnitName: null,
  locationId: "loc-1",
  locationName: "Worli",
  memberId: null,
  memberName: null,
  walkInName: "Desk guest",
  startsAt: "2026-11-02T10:30:00.000Z",
  endsAt: "2026-11-02T11:30:00.000Z",
  status: "confirmed",
  pricePaise: 50000,
  invoiceId: null,
  invoiceNumber: null,
  amountDuePaise: 0,
  billable: false,
};

const MEMBER_ROW: BookingDayRow = {
  ...WALK_IN_ROW,
  bookingId: "b-2",
  memberId: "m-1",
  memberName: "Rohan Shah",
  walkInName: null,
  billable: true,
};

function renderForm() {
  render(
    <BookingForm
      facilities={FACILITIES}
      timezone="Asia/Kolkata"
      today="2026-11-02"
      terminology={{ locale: "en", overrides: {} }}
      facilityId="f-1"
      onFacilityChange={() => {}}
      date="2026-11-02"
      onDateChange={() => {}}
      onCreated={() => {}}
    />,
  );
  fireEvent.click(screen.getByTestId("booking-mode-walk-in"));
  fireEvent.change(screen.getByTestId("booking-walkin-name"), {
    target: { value: "Desk guest" },
  });
  return screen.getByTestId("booking-create");
}

describe("INTENDED RED — the walk-in rule is stated without an internal release label", () => {
  it("states the walk-in billing limit in the form without naming a release", () => {
    renderForm();

    const hint = screen.getByText(/walk-in is recorded/i).textContent ?? "";
    expect(hint).toMatch(/cannot be billed/i);
    expect(hint).not.toMatch(/\bR1\b/);
  });

  it("states the same limit in the confirmation notice after a walk-in is booked", async () => {
    const create = renderForm();

    await vi.waitFor(() => {
      expect((create as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(create);

    const notice = await screen.findByText(/^Booked at/);
    const text = notice.textContent ?? "";
    expect(text).toMatch(/cannot be billed/i);
    expect(text).not.toMatch(/\bR1\b/);
  });

  it("states the limit on the walk-in row of the day board without a release label", () => {
    render(
      <BookingDayList
        rows={[WALK_IN_ROW]}
        busyId={null}
        onCancel={() => {}}
        onBill={() => {}}
      />,
    );

    const text = screen.getByTestId("booking-row").textContent ?? "";
    expect(text).toMatch(/cannot be billed/i);
    expect(text).not.toMatch(/\bR1\b/);
  });
});

describe("baseline — the walk-in billing guard this copy must not touch", () => {
  it("offers no bill action on a walk-in row and still offers it on a member row", () => {
    const { unmount } = render(
      <BookingDayList
        rows={[WALK_IN_ROW]}
        busyId={null}
        onCancel={() => {}}
        onBill={() => {}}
      />,
    );
    expect(screen.queryByTestId("booking-bill-button")).toBeNull();
    expect(screen.getByTestId("booking-cancel-button")).toBeTruthy();
    unmount();

    render(
      <BookingDayList
        rows={[MEMBER_ROW]}
        busyId={null}
        onCancel={() => {}}
        onBill={() => {}}
      />,
    );
    expect(screen.getByTestId("booking-bill-button")).toBeTruthy();
  });

  it("still books a walk-in with a name and no member", async () => {
    const create = renderForm();

    await vi.waitFor(() => {
      expect((create as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(create);

    await vi.waitFor(() => {
      expect(mocks.created).toHaveLength(1);
    });
    expect(mocks.created[0]).toMatchObject({
      memberId: null,
      walkInName: "Desk guest",
    });
  });
});
