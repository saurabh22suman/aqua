// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the owner enquiry row's
// created date.
//
// The enquiry list already carried the enquiry's `createdAt` — the row
// data had it — but the owner's row never showed it, so a list of
// enquiries could not be ordered or dated by the person reading it.
//
// The contract this file pins:
//
//   * the row's SECONDARY context carries a concise IST date (the day
//     the enquiry arrived, in the product's own zone) — the field is
//     the existing `createdAt`, not an invented one, and there is no
//     date query;
//   * a phone and a desktop show the SAME information;
//   * the name, the contact and the stage are untouched.
//
// No database: the board's only server action is stubbed.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/enquiries", () => ({
  createEnquiryAction: vi.fn(),
}));

import { EnquiriesBoard } from "@/components/enquiries-board";
import { formatDateIST } from "@/lib/time/tz";
import type { EnquiryRow } from "@/lib/services/enquiries";

// 24 Oct 2026, 20:00 UTC — which is already 25 Oct, 01:30 in IST. The
// row must say the IST day.
const CREATED_AT = new Date("2026-10-24T20:00:00.000Z");

const ENQUIRY: EnquiryRow = {
  id: "e1",
  fullName: "Meera Nair",
  phone: "+919812340011",
  source: "online",
  stage: "contacted",
  memberId: null,
  locationId: "loc-1",
  createdAt: CREATED_AT,
};

afterEach(cleanup);

function renderBoard() {
  return render(
    <EnquiriesBoard
      initialEnquiries={[ENQUIRY]}
      locations={[{ id: "loc-1", name: "Worli Main" }]}
      canWrite
      variant="oversight"
    />,
  );
}

/** The desktop table row and the phone list row of the same enquiry. */
function rowDates() {
  const desktop = within(
    screen.getByRole("table", { name: "Current enquiries" }),
  ).getAllByTestId("enquiry-row-created");
  const phone = within(
    screen.getByTestId("enquiries-list").querySelector("ul") as HTMLElement,
  ).getAllByTestId("enquiry-row-created");
  return { desktop, phone };
}

describe("the owner enquiry row's created date", () => {
  // RED: the row carries no date at all.
  it("shows the created date in IST", () => {
    renderBoard();

    const { desktop } = rowDates();
    expect(desktop).toHaveLength(1);
    expect(desktop[0]!.textContent?.trim()).toBe(formatDateIST(CREATED_AT));
    expect(desktop[0]!.textContent?.trim()).toBe("25 Oct 2026");
  });

  // CONTROL: a phone and a desktop show the same information.
  it("shows the same date on a phone and on a desktop", () => {
    renderBoard();

    const { desktop, phone } = rowDates();
    expect(phone).toHaveLength(1);
    expect(phone[0]!.textContent?.trim()).toBe(desktop[0]!.textContent?.trim());
  });

  // CONTROL: the date is a DAY, not a moment — the row stays concise.
  it("shows a concise day, not a time", () => {
    renderBoard();

    const { desktop } = rowDates();
    expect(desktop[0]!.textContent?.trim()).not.toMatch(/\d{1,2}:\d{2}/);
  });

  // CONTROL: the name, the contact and the stage are untouched.
  it("keeps the name, the contact and the stage", () => {
    renderBoard();

    const table = screen.getByRole("table", { name: "Current enquiries" });
    expect(table.textContent).toContain("Meera Nair");
    expect(table.textContent).toContain("+91 98123 40011");
    expect(table.textContent).toContain("Contacted");
    expect(table.textContent).toContain("online");
  });
});
