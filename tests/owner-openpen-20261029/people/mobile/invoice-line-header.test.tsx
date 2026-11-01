// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// The expanded invoice's line table must keep its headers apart.
//
// At 390 the mobile expanded invoice printed the column headers
// "AMOUNT" and "GST" flush against each other, so the row read as one
// word, "AMOUNTGST" (the reviewer's capture, boards/16-invoice.png).
//
// What this pins:
//
//   * the line table is a real table: one column header per column,
//     each scoped to its column, so a screen reader names the column
//     it is reading;
//   * the amount header keeps the SAME right-hand air the amount body
//     cell has, so the AMOUNT and GST headers cannot touch again;
//   * the invoice's own figures — the line amount, the CGST/SGST split,
//     the taxable/GST/total lines — are untouched.
//
// The rendered gap is measured in Chrome by the durable probe
// (invoice-header-gap-rendered.ts); this suite pins the structure
// behind it.

import { InvoiceSummary } from "@/components/member-detail/invoice-summary";
import type { InvoiceDetail } from "@/lib/services/invoices";

const DETAIL: InvoiceDetail = {
  id: "inv-1",
  memberId: "m1",
  memberName: "Aadhya Sharma",
  invoiceNumber: "INV/2026-27/0002",
  financialYear: "2026-27",
  documentKind: "bill_of_supply",
  issuedOn: "2026-10-30",
  dueOn: "2026-10-30",
  subtotalPaise: 100000,
  taxPaise: 18000,
  totalPaise: 118000,
  paidPaise: 0,
  outstandingPaise: 118000,
  status: "issued",
  source: "membership",
  gstin: null,
  locationId: "loc-1",
  locationName: "Worli Main",
  subscriptionId: null,
  activityName: null,
  createdAt: "2026-10-30T00:00:00.000Z",
  lines: [
    {
      id: "line-1",
      description: "Booking: Main pool",
      sacCode: "999723",
      amountPaise: 100000,
      taxRateBp: 1800,
      taxPaise: 18000,
      cgstPaise: 9000,
      sgstPaise: 9000,
    },
  ],
};

/** The right-hand padding utility a cell declares, if any. */
function rightPadding(className: string): string | null {
  return (
    className
      .split(/\s+/)
      .find((token) => /^pr-/.test(token)) ?? null
  );
}

function headerCells(): HTMLElement[] {
  const table = screen.getByRole("table");
  return Array.from(table.querySelectorAll("thead th"));
}

function bodyCells(): HTMLElement[] {
  const table = screen.getByRole("table");
  return Array.from(table.querySelectorAll("tbody tr:first-child td"));
}

afterEach(cleanup);

describe("the expanded invoice's line table", () => {
  it("names every column with a scoped column header", () => {
    render(<InvoiceSummary detail={DETAIL} capturedTotalPaise={0} canReadPayments />);

    const headers = headerCells();
    expect(headers).toHaveLength(4);
    expect(headers.map((cell) => cell.getAttribute("scope"))).toEqual([
      "col",
      "col",
      "col",
      "col",
    ]);
    expect(headers.map((cell) => cell.textContent?.trim())).toEqual([
      "Description",
      "SAC",
      "Amount",
      "GST",
    ]);
  });

  it("keeps the amount header's air the same as the amount cell's", () => {
    render(<InvoiceSummary detail={DETAIL} capturedTotalPaise={0} canReadPayments />);

    const headers = headerCells();
    const cells = bodyCells();
    // The amount column is the third one in both rows.
    const headerGap = rightPadding(headers[2]?.className ?? "");
    const cellGap = rightPadding(cells[2]?.className ?? "");
    expect(cellGap).not.toBeNull();
    expect(headerGap).toBe(cellGap);
  });

  it("keeps the line's amount and its CGST/SGST split exactly", () => {
    render(<InvoiceSummary detail={DETAIL} capturedTotalPaise={0} canReadPayments />);

    const table = screen.getByRole("table");
    expect(within(table).getByText("₹1,000.00")).toBeTruthy();
    expect(
      within(table).getByText("CGST ₹90.00 + SGST ₹90.00"),
    ).toBeTruthy();
  });

  it("keeps the taxable, GST and total lines exactly", () => {
    const { container } = render(
      <InvoiceSummary detail={DETAIL} capturedTotalPaise={0} canReadPayments />,
    );

    expect(container.textContent).toContain("Taxable ₹1,000.00 + GST ₹180.00");
    expect(container.textContent).toContain("₹1,180.00");
    expect(container.textContent).toContain("Paid ₹0.00");
    expect(container.textContent).toContain("outstanding ₹1,180.00");
  });
});
