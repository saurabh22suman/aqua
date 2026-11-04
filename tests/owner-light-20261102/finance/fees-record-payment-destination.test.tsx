// @vitest-environment jsdom
//
// Finance lane — NEGATIVE CONTROL (2 Nov 2026): the destination contract Home
// uses for "Record payment" is safe and must stay safe.
//
// CONTRACT: "Home Record payment must lead to explicit scoped unpaid invoice
// choice and existing manual confirmation, NEVER auto select bill/amount/pay
// or call a mutation via navigation."
//
// The safe existing destination is the Fees hub DUES tab
// (/owner/fees?tab=dues&facility=<scope>): it lists the unpaid invoices of the
// caller's scope, and the operator opens ONE invoice and confirms the payment
// inside it. Arriving there selects no bill, fills no amount, records nothing
// and calls no mutation.
//
// This file is a PASSING guard of that existing behaviour (baseline
// characterisation, not a RED): it fails if a future change auto-expands an
// invoice, auto-fills a payment amount, or fires a money mutation during
// navigation.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  overview: vi.fn(),
  invoices: vi.fn(),
  transactions: vi.fn(),
  plans: vi.fn(),
  recordPayment: vi.fn(),
  listRecovery: vi.fn(),
  cancelRecovery: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

// The dues list is a client island; it only needs the router for a
// post-mutation refresh. Navigation itself must never move money.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
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

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant",
    userId: "user",
    permissions: new Set([
      "reports.financial",
      "invoices.read",
      "payments.read",
      "payments.record",
      "invoices.write",
    ]),
    features: new Set(["reports", "billing"]),
  }),
  requirePagePermission: () => undefined,
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
  getFeesOverviewAction: s.overview,
  listHubInvoicesAction: s.invoices,
  listHubTransactionsAction: s.transactions,
}));

// Any money mutation a navigation could wrongly trigger is counted here.
vi.mock("@/lib/actions/payments", () => ({
  recordPaymentAction: s.recordPayment,
  listInvoicePaymentsAction: async () => [],
  listPaymentReversalsAction: async () => [],
}));

vi.mock("@/lib/actions/payment-intents", () => ({
  listPaymentRecoveryAction: s.listRecovery,
  cancelPaymentRecoveryAction: s.cancelRecovery,
}));

import FeesPage from "@/app/(owner)/owner/fees/page";

const FACILITY = "11111111-1111-4111-8111-111111111111";

const UNPAID = {
  id: "22222222-2222-4222-8222-222222222222",
  invoiceNumber: "INV-2026-0042",
  memberId: "33333333-3333-4333-8333-333333333333",
  memberName: "Asha Rao",
  totalPaise: 300000,
  paidPaise: 100000,
  outstandingPaise: 200000,
  status: "partial",
  source: "manual",
  issuedOn: "2026-10-20",
  dueOn: "2026-10-25",
  locationName: "Splash Pool",
};

beforeEachReset();

function beforeEachReset() {
  s.overview.mockReset().mockResolvedValue({
    from: "2026-10-01",
    to: "2026-10-31",
    collectedPaise: 500000,
    paymentCount: 1,
    reversedPaise: 0,
    reversalCount: 0,
    outstandingPaise: 200000,
    dueInvoiceCount: 1,
    overduePaise: 0,
    overdueInvoiceCount: 0,
    overdueAgeing: [],
    today: "2026-11-02",
  });
  s.invoices.mockReset().mockResolvedValue([UNPAID]);
  s.transactions.mockReset().mockResolvedValue({
    rows: [],
    totalCount: 0,
    truncated: false,
    limit: 200,
  });
  s.recordPayment.mockReset();
  s.listRecovery.mockReset().mockResolvedValue({ open: null, lastCommitted: null });
  s.cancelRecovery.mockReset();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Fees dues destination (Home 'Record payment' target)", () => {
  it("lists the scoped unpaid invoices and selects nothing on arrival", async () => {
    render(
      await FeesPage({
        searchParams: Promise.resolve({ tab: "dues", facility: FACILITY }),
      }),
    );

    // The choice is scoped: the dues read carries the caller's facility.
    expect(s.invoices).toHaveBeenCalledWith({
      status: "dues",
      locationId: FACILITY,
    });

    // The unpaid invoice is offered, with its outstanding balance in words.
    expect(screen.getByText(/INV-2026-0042/)).toBeTruthy();
    expect(screen.getByText("Asha Rao")).toBeTruthy();
    expect(screen.getByText(/₹2,000\.00/)).toBeTruthy();

    // An explicit per-invoice action exists; nothing is already open.
    const open = screen.getAllByRole("button", { name: "Open" });
    expect(open.length).toBeGreaterThan(0);
    for (const button of open) {
      expect(button.getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("records nothing and calls no money mutation on arrival", async () => {
    render(
      await FeesPage({
        searchParams: Promise.resolve({ tab: "dues", facility: FACILITY }),
      }),
    );

    // No amount is pre-selected and no payment form is present.
    expect(screen.queryByText("Record a payment")).toBeNull();
    expect(screen.queryByTestId("invoice-payment-amount")).toBeNull();

    // Navigation alone never moves money.
    expect(s.recordPayment).not.toHaveBeenCalled();
  });
});
