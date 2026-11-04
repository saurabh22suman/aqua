// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Reviewed backend contract integration — intended RED before the Fees page
// consumes the transaction PAGE object and the gross-collections copy.

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
vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ overrides: {}, locale: "en" }),
}));
vi.mock("@/lib/actions/membership-plans", () => ({ listPlansAction: async () => [] }));
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
vi.mock("@/lib/actions/fees-hub", () => ({
  getFeesOverviewAction: async () => ({
    from: "2026-10-01",
    to: "2026-10-31",
    collectedPaise: 100000,
    paymentCount: 14,
    reversedPaise: 20000,
    reversalCount: 2,
    outstandingPaise: 0,
    dueInvoiceCount: 0,
    overduePaise: 0,
    overdueInvoiceCount: 0,
    overdueAgeing: [],
    today: "2026-10-29",
  }),
  listHubInvoicesAction: async () => [],
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
    totalCount: 5,
    truncated: true,
    limit: 1,
  }),
}));

import FeesPage from "@/app/(owner)/owner/fees/page";

afterEach(cleanup);

describe("reviewed fees backend contract", () => {
  it("renders the transaction page and an honest truncation notice", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "transactions" }) }));

    expect(document.body.textContent).toContain("Aaradhya Iyer");
    expect(document.body.textContent).toMatch(/Showing the newest 1 of 5 transactions/);
  });

  it("names collections as gross and reversals separately", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));

    const text = document.body.textContent ?? "";
    expect(text).toContain("captured at the counter");
    expect(text).toContain("₹200.00 reversed separately");
    expect(text).not.toMatch(/net of/i);
  });
});
