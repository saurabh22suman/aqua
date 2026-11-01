// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen · Member detail — intended RED for the remaining
// user-facing evidence gaps:
//   1. A subscription state must read as "Active", not the raw database
//      value "active".
//   2. A member invoice row must state its due date and balance explicitly,
//      not only bury the balance in a sentence.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/actions/subscriptions", () => ({
  listMemberSubscriptionsAction: async () => [
    {
      id: "sub-1",
      memberId: "m1",
      planId: "plan-1",
      planName: "Quarterly Membership",
      planKind: "duration",
      amountPaise: 1200000,
      locationId: "loc-1",
      locationName: "Worli Main",
      activityId: null,
      activityName: null,
      startsOn: "2026-10-22",
      endsOn: "2027-01-19",
      status: "active",
      pausedFrom: null,
      pausedUntil: null,
      autoRenew: false,
      createdAt: "2026-10-22T04:00:00.000Z",
    },
  ],
}));
vi.mock("@/lib/actions/membership-plans", () => ({
  listPlansAction: async () => [],
}));
vi.mock("@/lib/actions/invoices", () => ({
  createInvoiceAction: vi.fn(),
  listMemberInvoicesAction: async () => [
    {
      id: "inv-1",
      invoiceNumber: "INV/2026-27/0001",
      financialYear: "2026-27",
      documentKind: "tax_invoice",
      issuedOn: "2026-10-22",
      dueOn: "2026-11-21",
      subtotalPaise: 1200000,
      taxPaise: 0,
      totalPaise: 1200000,
      paidPaise: 0,
      outstandingPaise: 1200000,
      status: "issued",
      source: "membership",
      gstin: null,
      locationId: "loc-1",
      locationName: "Worli Main",
      subscriptionId: "sub-1",
      activityName: null,
      createdAt: "2026-10-22T04:00:00.000Z",
    },
  ],
  getInvoiceAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: vi.fn(async () => []),
  recordPaymentAction: vi.fn(),
}));

import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";
import { MemberInvoicesPanel } from "@/components/member-detail/member-invoices-panel";

afterEach(cleanup);

describe("member plan evidence", () => {
  it("shows a readable Active subscription state", async () => {
    render(<MemberSubscriptionPanel memberId="m1" canManage={false} />);

    await waitFor(() =>
      expect(document.body.textContent).toContain("Quarterly Membership"),
    );
    expect(screen.getByTestId("subscription-status").textContent).toBe("Active");
  });
});

describe("member invoice evidence", () => {
  it("states the due date and balance on the row", async () => {
    render(
      <MemberInvoicesPanel
        memberId="m1"
        canWrite={false}
        canRecord
        canRefund={false}
        canReadPayments
        timezone="Asia/Kolkata"
        showHeading={false}
      />,
    );

    await waitFor(() =>
      expect(document.body.textContent).toContain("INV/2026-27/0001"),
    );
    expect(screen.getByTestId("member-invoice-due").textContent).toContain(
      "21 Nov 2026",
    );
    expect(screen.getByTestId("member-invoice-balance").textContent).toContain(
      "₹12,000.00",
    );
  });
});
