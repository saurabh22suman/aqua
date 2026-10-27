// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign · People lane (C2) — composition of the remaining
// people surfaces: the staff directory, owner enquiry oversight, the
// invoice ledger and the announcements hub.
//
// RED target (branch feat/owner-redesign-people-c2, base d1425e7):
//
//   1. The staff directory buried the login state in a meta sentence
//      ("has login" / "no login yet") and printed the employment date
//      as a raw ISO string (2026-06-01), so "directory record" and
//      "login access" were not separable and the date broke DESIGN.md
//      §4's date format.
//   2. The owner enquiry board led with the routine capture card, so
//      owner oversight was not the first thing on the page, and the
//      enquiry pipeline had no stage filter even though the read
//      supports one.
//   3. The invoice ledger printed the raw database state ("issued") in
//      a bare chip instead of the shared status pill with a readable
//      word.
//   4. The announcements hub put "Your notifications" between the
//      composer and the sent history, so the three surfaces read as
//      one undifferentiated list.

vi.mock("@/lib/actions/fees-hub", () => ({
  listHubInvoicesAction: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { StaffBoard } from "@/components/staff-board";
import { EnquiriesBoard } from "@/components/enquiries-board";
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import type { StaffRow } from "@/lib/services/staff";
import type { EnquiryRow } from "@/lib/services/enquiry-scope";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";

const STAFF: StaffRow[] = [
  {
    id: "s1",
    personId: "person-1",
    fullName: "Aanya Rao",
    userId: "user-1",
    staffType: "coach",
    employedOn: "2026-06-01",
  },
  {
    id: "s2",
    personId: "person-2",
    fullName: "Anil Shah",
    userId: null,
    staffType: "accountant",
    employedOn: "2026-09-12",
  },
] as unknown as StaffRow[];

const ENQUIRY: EnquiryRow = {
  id: "e1",
  fullName: "Meera Nair",
  phone: "+919812340011",
  source: "online",
  stage: "contacted",
  memberId: null,
  locationId: "loc-1",
  createdAt: new Date("2026-10-25T04:00:00.000Z"),
} as unknown as EnquiryRow;

const INVOICE: HubInvoiceRow = {
  id: "inv-1",
  invoiceNumber: "INV/2026-27/0001",
  memberId: "m1",
  memberName: "Aaradhya Iyer",
  totalPaise: 280000,
  paidPaise: 0,
  outstandingPaise: 280000,
  status: "issued",
  source: "membership",
  issuedOn: "2026-10-01",
  dueOn: "2026-10-10",
  locationName: "Worli Main",
} as unknown as HubInvoiceRow;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("staff directory (C2)", () => {
  it("states login access explicitly on every row", () => {
    render(<StaffBoard rows={STAFF} />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Login access");
    // P2 (independent review) — a linked identity is not an active
    // login, so the row states the link, never "Active".
    expect(text).toContain("Linked");
    expect(text).toContain("Not linked");
  });

  it("prints the employment date in the readable form", () => {
    render(<StaffBoard rows={STAFF} />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("1 Jun 2026");
    expect(text).not.toContain("2026-06-01");
  });
});

describe("owner enquiry oversight (C2)", () => {
  it("leads with the enquiries and keeps routine capture secondary", () => {
    render(
      <EnquiriesBoard
        initialEnquiries={[ENQUIRY]}
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        canWrite
        variant="oversight"
      />,
    );

    // Capture is not the first thing on the owner's page.
    expect(screen.queryByTestId("enquiry-capture-submit")).toBeNull();

    const list = screen.getByTestId("enquiries-list");
    const toggle = screen.getByRole("button", { name: /capture an enquiry/i });
    expect(
      list.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the oversight list precedes the capture control",
    ).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByTestId("enquiry-capture-submit")).toBeTruthy();
  });

  it("keeps the reception front-desk order unchanged by default", () => {
    render(
      <EnquiriesBoard
        initialEnquiries={[ENQUIRY]}
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        canWrite
      />,
    );

    const submit = screen.getByTestId("enquiry-capture-submit");
    const list = screen.getByTestId("enquiries-list");
    expect(
      submit.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
      "reception still captures first",
    ).toBeTruthy();
  });

  it("keeps a typed name in the capture form when the save is refused", () => {
    render(
      <EnquiriesBoard
        initialEnquiries={[ENQUIRY]}
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        canWrite
      />,
    );

    const name = screen.getByTestId("enquiry-capture-name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Typed Name" } });
    fireEvent.click(screen.getByTestId("enquiry-capture-submit"));

    expect(name.value).toBe("Typed Name");
  });
});

describe("invoice ledger (C2)", () => {
  it("shows the invoice state as a readable word, not a raw state value", () => {
    render(
      <FeesInvoiceList
        initial={[INVOICE]}
        filter="all"
        canWrite={false}
        canRecord
        canRefund={false}
        canReadPayments
      />,
    );

    const pill = screen.getByTestId("invoice-status");
    expect(pill.textContent).toBe("Issued");
  });
});
