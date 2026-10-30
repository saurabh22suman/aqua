// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen · People lane — intended RED for the reference composition.
//
// These assertions record user-visible arrangement and navigation, not CSS
// class strings:
//   1. The members directory must name its surface, show the joined date in
//      the same comparable row as phone/participation, and offer one clear
//      row action ("Open").
//   2. The fees ledger must expose the same comparable columns as the
//      reference (due date, total, balance, state) before expanding a row.
//   3. The member overview must be composable: the owner can ask for only
//      the contacts/consent sections so participation and contact context
//      sit side by side; reception keeps the full default composition.
//   4. The create form must offer a real Cancel destination as the reference
//      bounded editor does.

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: vi.fn(async () => []),
  createMemberAction: vi.fn(),
  searchPersonsAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/fees-hub", () => ({
  listHubInvoicesAction: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { MembersBoard } from "@/components/members-board";
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import { MemberProfileSections } from "@/components/member-detail/member-profile-sections";
import { MemberCreateForm } from "@/components/member-create-form";
import type { MemberListRow, MemberDetail } from "@/lib/services/people";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";

const MEMBER: MemberListRow = {
  memberId: "m1",
  personId: "p1",
  fullName: "Aaradhya Iyer",
  phone: "+919000000101",
  memberCode: "SSC-002",
  status: "active",
  locationId: "loc-1",
  locationName: "Worli Main",
  isMinor: true,
  createdAt: "2026-10-10T04:00:00.000Z",
  joinedOn: "2026-10-10",
};

const INVOICE: HubInvoiceRow = {
  id: "inv-1",
  invoiceNumber: "INV/2026-27/0001",
  memberId: "m1",
  memberName: "Aaradhya Iyer",
  totalPaise: 280000,
  paidPaise: 100000,
  outstandingPaise: 180000,
  status: "partial",
  source: "membership",
  issuedOn: "2026-10-01",
  dueOn: "2026-10-10",
  locationName: "Worli Main",
};

const DETAIL = {
  memberId: "m1",
  fullName: "Aaradhya Iyer",
  isMinor: true,
  guardians: [
    {
      personId: "g1",
      fullName: "Priya Iyer",
      relationship: "Mother",
      phone: "+919000000101",
      isPrimary: true,
    },
  ],
  consents: [
    {
      purpose: "processing",
      withdrawnAt: null,
      granterName: "Priya Iyer",
    },
  ],
  statusHistory: [],
} as unknown as MemberDetail;

const ATTENDANCE = {
  rows: [],
  today: "2026-10-29",
} as unknown as Parameters<typeof MemberProfileSections>[0]["attendanceHistory"];

afterEach(cleanup);

describe("members directory (reference composition)", () => {
  it("names the directory surface and compares identity, phone, joined and participation", () => {
    render(<MembersBoard initialMembers={[MEMBER]} />);

    expect(screen.getByRole("heading", { name: "Member directory" })).toBeTruthy();
    expect(
      screen.getByTestId("members-table-head").textContent,
    ).toContain("Member since");
    expect(screen.getByText("10 Oct 2026")).toBeTruthy();
    expect(screen.getByText("SSC-002 · Worli Main")).toBeTruthy();
  });

  it("offers one contextual row action", () => {
    render(<MembersBoard initialMembers={[MEMBER]} />);

    const row = screen.getByTestId("member-row");
    expect(row.textContent).toContain("Open");
    expect(row.tagName).toBe("A");
    expect(row.getAttribute("href")).toBe("/owner/members/m1");
  });
});

describe("fees ledger (reference composition)", () => {
  it("shows due date, total, balance and state before opening the invoice", () => {
    render(
      <FeesInvoiceList
        initial={[INVOICE]}
        filter="dues"
        canWrite={false}
        canRecord
        canRefund={false}
        canReadPayments
      />,
    );

    const head = screen.getByTestId("invoice-ledger-head").textContent ?? "";
    expect(head).toContain("Due");
    expect(head).toContain("Invoice total");
    expect(head).toContain("Balance");
    expect(head).toContain("State");
    expect(screen.getAllByText("10 Oct 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₹2,800.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₹1,800.00").length).toBeGreaterThan(0);
  });
});

describe("member overview composition", () => {
  it("can render only contacts and consent for the side-by-side owner layout", () => {
    render(
      <MemberProfileSections
        member={DETAIL}
        attendanceHistory={ATTENDANCE}
        terminology={{ overrides: {}, locale: "en" }}
        sections={["guardians", "consent"]}
      />,
    );

    expect(screen.getByRole("heading", { name: /guardians/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /consent/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /attendance/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /status history/i })).toBeNull();
  });
});

describe("bounded create editor", () => {
  it("offers a real Cancel destination", () => {
    render(
      <MemberCreateForm
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        terminology={{ overrides: {}, locale: "en" }}
      />,
    );

    const cancel = screen.getByRole("link", { name: /cancel/i });
    expect(cancel.getAttribute("href")).toBe("/owner/members");
  });
});
