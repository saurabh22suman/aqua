// @vitest-environment jsdom
//
// Lane c-money — the Fees hub screen must state the money the way the
// approved contract says it is stated.
//
//   docs/design-system/screens.md (/owner/fees): "A reversal is
//   stated beside the total and is ledger-only: it is never netted
//   into the collected figure."
//   docs/design-system/flows.md O1: the same, for the collected
//   total.
//
// So the "Collected in this period" tile is the GROSS of the captured
// counter payments and the reversal is stated BESIDE it — never
// subtracted, never described as a bank refund.
//
// The ledger list is capped, so the screen must say that it is showing
// the first N of M instead of presenting a truncated list as the whole
// period.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    roleKey: "owner",
    permissions: new Set(["reports.financial", "settings.manage"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/lib/actions/membership-plans", () => ({
  listPlansAction: async () => [],
}));

vi.mock("@/lib/actions/fees-hub", () => ({
  getFeesOverviewAction: vi.fn(async () => OVERVIEW),
  listHubInvoicesAction: vi.fn(async () => []),
  listHubTransactionsAction: vi.fn(async () => LEDGER),
}));

import FeesPage from "@/app/(owner)/owner/fees/page";

const OVERVIEW = {
  from: "2026-10-01",
  to: "2026-10-31",
  collectedPaise: 100000,
  paymentCount: 1,
  reversedPaise: 30000,
  reversalCount: 1,
  outstandingPaise: 4280000,
  dueInvoiceCount: 4,
  overduePaise: 1260000,
  overdueInvoiceCount: 2,
  overdueAgeing: [],
  today: "2026-10-27",
};

const LEDGER_ROWS = Array.from({ length: 3 }, (_, index) => ({
  id: `pay-${index}`,
  receivedAt: "2026-10-10T10:00:00.000Z",
  amountPaise: 100000,
  method: "cash" as const,
  reference: null,
  invoiceNumber: "INV/2026-27/0001",
  memberId: "m1",
  memberName: "Member One",
  locationName: "Worli",
  receivedByName: "Desk",
  kind: "payment" as const,
  reason: null,
}));

// The ledger payload: the rows AND the number of rows the filter
// matches. The mock returns an array that also carries those
// properties, so the same payload renders whether the page reads the
// rows off the array or off the payload — what the assertions below
// check is the TEXT the page states, not a crash on the payload shape.
const LEDGER = Object.assign([...LEDGER_ROWS], {
  rows: LEDGER_ROWS,
  totalCount: 342,
  truncated: true,
  limit: 200,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the fees hub states the money the way the contract says", () => {
  it("states the reversal beside the collected figure and never nets it", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));

    const text = document.body.textContent ?? "";
    // The collected figure is the gross capture.
    expect(text).toMatch(/collected in this period/i);
    // The reversal is stated beside it, in plain words, with its count.
    expect(text).toMatch(/reversed separately/i);
    expect(text).toMatch(/₹300\.00 reversed separately \(1\)/);
    // And it is never described as deducted from the collection.
    expect(text).not.toMatch(/net of/i);
  });

  it("never implies the reversal is a bank refund", async () => {
    render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/refund(ed)? (back )?to the/i);
    expect(text).not.toMatch(/bank refund/i);
  });

  it("says how many transactions the period holds when the list is truncated", async () => {
    render(
      await FeesPage({
        searchParams: Promise.resolve({
          tab: "transactions",
          from: "2026-10-01",
          to: "2026-10-31",
        }),
      }),
    );

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/showing the newest 3 of 342 transactions/i);
  });
});
