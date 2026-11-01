// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner mobile dues/invoice layout — intended RED.
// Approved reference pairs Due/Invoice total/Balance/State in two columns
// under the identity, with a full-width footer and one 44px Open action.
// The balance must not be repeated in the footer.

vi.mock("@/lib/actions/fees-hub", () => ({ listHubInvoicesAction: vi.fn() }));
vi.mock("@/lib/actions/invoices", () => ({
  getInvoiceAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: vi.fn(),
  recordPaymentAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/components/member-detail/invoice-expanded", () => ({
  InvoiceExpanded: ({ invoiceId }: { invoiceId: string }) => (
    <div data-testid="expanded-invoice">{invoiceId}</div>
  ),
}));

import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";

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

afterEach(cleanup);

describe("mobile dues row grouping", () => {
  it("pairs the four evidence fields under a full-width identity and footer", () => {
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

    const row = screen.getByTestId("invoice-ledger-row");
    expect(row.className).toContain("grid-cols-2");
    const cells = Array.from(row.children) as HTMLElement[];
    expect(cells[0].className).toContain("col-span-2");
    expect(cells[cells.length - 1].className).toContain("col-span-2");

    const text = row.textContent ?? "";
    expect(text).toContain("10 Oct 2026");
    expect(text).toContain("₹2,800.00");
    expect(text).toContain("₹1,800.00");
    expect(text).toContain("Partially paid");
    expect(text).not.toContain("₹1,800.00 outstanding");
    expect(screen.getAllByText("₹1,800.00")).toHaveLength(1);
  });

  it("keeps the row Open action one 44px control that expands in place", () => {
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

    const row = screen.getByTestId("invoice-ledger-row");
    const open = Array.from(row.querySelectorAll("button")).find(
      (button) => button.textContent === "Open",
    ) as HTMLButtonElement;
    expect(open).toBeTruthy();
    expect(open.className).toContain("min-h-11");
    fireEvent.click(open);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("expanded-invoice").textContent).toBe("inv-1");
  });
});
