// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// P1 CR-04 — the custom responsive ledgers must keep real table semantics on
// desktop: caption, column headers with scope, header/row relationships.
// P1 CR-05 — the create form's Cancel must follow the caller's role-safe list
// base, not a hardcoded owner path.

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
vi.mock("@/lib/actions/fees-hub", () => ({ listHubInvoicesAction: vi.fn() }));
vi.mock("@/lib/actions/invoices", () => ({
  createInvoiceAction: vi.fn(),
  listMemberInvoicesAction: vi.fn(),
  getInvoiceAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: vi.fn(),
  recordPaymentAction: vi.fn(),
}));
vi.mock("@/lib/actions/people", () => ({
  createMemberAction: vi.fn(),
  searchPersonsAction: vi.fn(async () => []),
}));

import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import { FeesTransactionList } from "@/components/fees/fees-transaction-list";
import { MemberCreateForm } from "@/components/member-create-form";
import type { HubInvoiceRow, HubTransactionRow } from "@/lib/services/fees-hub";

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

const TRANSACTION: HubTransactionRow = {
  id: "txn-1",
  receivedAt: "2026-10-10T04:30:00.000Z",
  amountPaise: 100000,
  method: "cash",
  reference: null,
  invoiceNumber: "INV/2026-27/0001",
  memberId: "m1",
  memberName: "Aaradhya Iyer",
  locationName: "Worli Main",
  receivedByName: "Reception",
  kind: "payment",
  reason: null,
};

afterEach(cleanup);

describe("P1 CR-04 desktop ledger semantics", () => {
  it("exposes the invoice ledger as a named table with scoped columns", () => {
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

    const table = screen.getByRole("table", { name: /invoice ledger/i });
    expect(table).toBeTruthy();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["Member / invoice", "Due", "Invoice total", "Balance", "State", "Action"]);
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.getAttribute("scope")).toBe("col");
    }
    expect(screen.getByRole("cell", { name: /Aaradhya Iyer/i })).toBeTruthy();
  });

  it("exposes the transaction ledger as a named table with scoped columns", () => {
    render(<FeesTransactionList rows={[TRANSACTION]} memberLabel="Member" />);

    const table = screen.getByRole("table", { name: /transactions/i });
    expect(table).toBeTruthy();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["Member", "Recorded", "Method", "Amount"]);
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.getAttribute("scope")).toBe("col");
    }
  });
});

describe("P1 CR-05 create Cancel base", () => {
  it("returns owner callers to the owner member list", () => {
    render(
      <MemberCreateForm
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        terminology={{ overrides: {}, locale: "en" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe(
      "/owner/members",
    );
  });

  it("returns reception callers to the reception member list", () => {
    render(
      <MemberCreateForm
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        terminology={{ overrides: {}, locale: "en" }}
        memberDetailBasePath="/reception/members"
      />,
    );
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe(
      "/reception/members",
    );
  });
});
