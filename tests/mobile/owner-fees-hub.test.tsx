// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// U-02 — the Fees hub tabs and invoice/dues lists. The invoice list
// is a client island over the existing InvoiceExpanded collect flow;
// actions are mocked so the render test stays a render test.

const listHubInvoicesAction = vi.fn();
vi.mock("@/lib/actions/fees-hub", () => ({
  listHubInvoicesAction: (...args: unknown[]) => listHubInvoicesAction(...args),
}));
vi.mock("@/lib/actions/invoices", () => ({
  getInvoiceAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: vi.fn(),
  recordPaymentAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { FEES_TABS, FeesTabs } from "@/components/fees/fees-tabs";
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";

const PERIOD = { from: "2026-09-01", to: "2026-10-01" };

const DUE: HubInvoiceRow = {
  id: "11111111-1111-1111-1111-111111111111",
  invoiceNumber: "2026-0001",
  memberId: "22222222-2222-2222-2222-222222222222",
  memberName: "Ananya Sharma",
  totalPaise: 250_000,
  paidPaise: 0,
  outstandingPaise: 250_000,
  status: "issued",
  source: "membership",
  issuedOn: "2026-09-01",
  dueOn: "2026-09-10",
  locationName: "Worli",
};

afterEach(() => {
  cleanup();
  listHubInvoicesAction.mockReset();
});

describe("U-02 fees hub tabs", () => {
  it("renders Overview / Transactions / Dues / Invoices / Plans and nothing about discounts", () => {
    render(<FeesTabs active="overview" period={PERIOD} />);
    for (const label of ["Overview", "Transactions", "Dues", "Invoices", "Plans"]) {
      expect(
        Array.from(document.querySelectorAll("a")).some(
          (a) => a.textContent === label,
        ),
        `missing tab ${label}`,
      ).toBe(true);
    }
    expect(FEES_TABS.map((t) => t.key)).toEqual([
      "overview",
      "transactions",
      "dues",
      "invoices",
      "plans",
    ]);
  });
});

describe("U-02 dues list", () => {
  it("renders a collectible pending invoice with member, number and outstanding amount", async () => {
    listHubInvoicesAction.mockResolvedValue([DUE]);
    const { findByText } = render(
      <FeesInvoiceList initial={[DUE]} filter="dues" canWrite canRecord />,
    );
    expect(await findByText("Ananya Sharma")).toBeTruthy();
    expect(document.body.textContent).toContain("2026-0001");
    expect(document.body.textContent).toContain("outstanding");
    expect(document.body.textContent).toContain("Open");
  });

  it("says so when nothing is outstanding", () => {
    listHubInvoicesAction.mockResolvedValue([]);
    render(
      <FeesInvoiceList initial={[]} filter="dues" canWrite canRecord={false} />,
    );
    expect(document.body.textContent).toMatch(/nothing outstanding/i);
  });
});
