// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen · Fees — intended RED for the actual rendered presentation:
//   1. Dues and Invoices must read as current-state documents, not as a
//      reporting period that could falsely limit the balances to one month.
//   2. Dues and Invoices must be ONE bounded ledger surface with divided rows,
//      not a canvas of independent invoice cards.
// The RED is the rendered page text/structure, not a class-name snapshot.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({ permissions: new Set() }),
  requirePagePermission: () => undefined,
}));
vi.mock("@/lib/auth/permission", () => ({
  hasPermission: () => true,
  hasFeature: () => true,
}));

const ROWS = [
  {
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
  },
  {
    id: "inv-2",
    invoiceNumber: "INV/2026-27/0002",
    memberId: "m2",
    memberName: "Rohan Shah",
    totalPaise: 320000,
    paidPaise: 0,
    outstandingPaise: 320000,
    status: "issued",
    source: "membership",
    issuedOn: "2026-10-01",
    dueOn: "2026-10-15",
    locationName: "Worli Main",
  },
];

vi.mock("@/lib/actions/fees-hub", () => ({
  getFeesOverviewAction: async () => ({
    from: "2026-10-01",
    to: "2026-10-31",
    collectedPaise: 1820000,
    paymentCount: 12,
    reversedPaise: 0,
    reversalCount: 0,
    outstandingPaise: 4280000,
    dueInvoiceCount: 4,
    overduePaise: 1260000,
    overdueInvoiceCount: 4,
    overdueAgeing: [],
    today: "2026-10-29",
  }),
  listHubInvoicesAction: async () => ROWS,
  listHubTransactionsAction: async () => ({
    rows: [
      {
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
      },
    ],
    totalCount: 1,
    truncated: false,
    limit: 200,
  }),
}));
vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ overrides: {}, locale: "en" }),
}));
vi.mock("@/lib/actions/membership-plans", () => ({
  listPlansAction: async () => [],
}));
vi.mock("@/lib/actions/invoices", () => ({
  createInvoiceAction: vi.fn(),
  listMemberInvoicesAction: vi.fn(async () => []),
  getInvoiceAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/actions/subscriptions", () => ({
  listMemberSubscriptionsAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: vi.fn(async () => []),
  recordPaymentAction: vi.fn(),
}));

import FeesPage from "@/app/(owner)/owner/fees/page";

afterEach(cleanup);

describe("fees purpose copy", () => {
  it("does not put a reporting period on the current Dues view", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "dues" }) }));

    const text = document.body.textContent ?? "";
    expect(text).toContain("Current balances");
    expect(text).not.toContain("Period 1 Oct 2026");
    expect(text).not.toContain("Asia/Kolkata");
  });

  it("does not put a reporting period on the current Invoices view", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "invoices" }) }));

    const text = document.body.textContent ?? "";
    expect(text).toContain("Invoice documents");
    expect(text).not.toContain("Period 1 Oct 2026");
    expect(text).not.toContain("Asia/Kolkata");
  });

  it("keeps the period on the Overview where the figures are period-bound", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));

    const text = document.body.textContent ?? "";
    expect(text).toContain("Period");
    expect(text).toContain("Asia/Kolkata");
  });
});

describe("fees ledger composition", () => {
  it("renders one bounded ledger surface containing the header and divided rows", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "dues" }) }));

    const surface = screen.getByTestId("invoice-ledger-surface");
    const head = screen.getByTestId("invoice-ledger-head");
    const rows = screen.getAllByTestId("invoice-ledger-row");

    expect(surface.contains(head)).toBe(true);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(surface.contains(row)).toBe(true);
  });
});

describe("transactions composition", () => {
  it("puts the member identity before the recorded time and uses one reflow row", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "transactions" }) }));

    const surface = screen.getByTestId("fees-transaction-surface");
    const head = screen.getByTestId("fees-transaction-head");
    const rows = screen.getAllByTestId("fees-transaction-row");

    expect(surface.contains(head)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(surface.contains(rows[0])).toBe(true);
    expect(head.textContent?.indexOf("Member")).toBeLessThan(
      head.textContent?.indexOf("Recorded") ?? -1,
    );
  });
});
