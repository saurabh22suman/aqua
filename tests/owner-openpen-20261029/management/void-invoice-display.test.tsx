// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A VOID invoice is not collectible.
//
// The invoice service already refuses to collect a void document, so a
// void row that still carries the red Overdue badge and the words
// "Balance outstanding" tells the owner that money is owed for a
// document that can never be paid. That is a DISPLAY bug under the
// existing rule, not a new financial rule.
//
// What this pins:
//
//   * a void past-due document is NOT labelled overdue;
//   * a void document does NOT claim a collectible balance;
//   * an issued (or partially paid) past-due document IS still labelled
//     overdue — the suppression is scoped to the void status alone;
//   * the STORED figures (invoice total, balance, state) are untouched:
//     a void document keeps its stored balance, only the collectible
//     wording goes.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
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
  getInvoiceAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: vi.fn(),
}));
vi.mock("@/lib/actions/payment-reversals", () => ({
  listPaymentReversalsAction: vi.fn(),
}));

import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";

// Fixed dates, far from today: the ledger compares a document's due date
// with the academy day, and this suite must not depend on the day it
// runs.
const PAST_DUE = "2020-01-10";
const NOT_DUE = "2099-01-10";

function invoice(overrides: Partial<HubInvoiceRow> = {}): HubInvoiceRow {
  return {
    id: "inv-1",
    invoiceNumber: "INV/2026-27/0001",
    memberId: "m1",
    memberName: "Aadhya Sharma",
    totalPaise: 125000,
    paidPaise: 0,
    outstandingPaise: 125000,
    status: "issued",
    source: "membership",
    issuedOn: "2020-01-01",
    dueOn: PAST_DUE,
    locationName: "Worli Main",
    ...overrides,
  };
}

function renderLedger(rows: HubInvoiceRow[]) {
  return render(
    <FeesInvoiceList
      initial={rows}
      filter="all"
      canWrite={false}
      canRecord
      canRefund={false}
      canReadPayments
    />,
  );
}

afterEach(cleanup);

describe("the invoice ledger's collectible wording", () => {
  it("does not label a void past-due document overdue", () => {
    renderLedger([invoice({ status: "void" })]);

    expect(screen.queryByText("Overdue")).toBeNull();
  });

  it("does not claim a collectible balance for a void document", () => {
    renderLedger([invoice({ status: "void" })]);

    expect(screen.queryByText("Balance outstanding")).toBeNull();
  });

  it("keeps the void document's stored figures and its state", () => {
    renderLedger([invoice({ status: "void" })]);

    const row = screen.getByTestId("invoice-ledger-row");
    // The stored figures are untouched and asserted one cell at a
    // time: the document still says what it says. Only the collectible
    // wording is gone.
    const totalCell = within(row).getByText("Invoice total").closest("td");
    const balanceCell = within(row).getByText("Balance").closest("td");
    expect(totalCell?.textContent).toContain("₹1,250.00");
    expect(balanceCell?.textContent).toContain("₹1,250.00");
    expect(within(row).getByText("Void")).toBeTruthy();
  });

  it("still labels an issued past-due document overdue", () => {
    renderLedger([invoice({ status: "issued" })]);

    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("Balance outstanding")).toBeTruthy();
  });

  it("still labels a partially paid past-due document overdue", () => {
    renderLedger([
      invoice({
        status: "partial",
        paidPaise: 25000,
        outstandingPaise: 100000,
      }),
    ]);

    expect(screen.getByText("Overdue")).toBeTruthy();
  });

  it("does not label a void document that is not yet due", () => {
    renderLedger([invoice({ status: "void", dueOn: NOT_DUE })]);

    expect(screen.queryByText("Overdue")).toBeNull();
  });

  it("does not label a paid document overdue", () => {
    renderLedger([
      invoice({ status: "paid", paidPaise: 125000, outstandingPaise: 0 }),
    ]);

    expect(screen.queryByText("Overdue")).toBeNull();
    expect(screen.getByText("Nothing outstanding")).toBeTruthy();
  });

  it("leaves the other statuses' wording exactly as it was", () => {
    // The correction is scoped to the void status. A draft is not
    // collectible either, but that is a settlement rule this change
    // does not make: a draft past-due document still reads overdue, as
    // it did before.
    renderLedger([invoice({ status: "draft" })]);

    expect(screen.getByText("Overdue")).toBeTruthy();
  });
});
