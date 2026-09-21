// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR2-C9 — the invoice panel reverses a captured payment with a
// reason, shows the reversed amount, and hides the action from a role
// without payments.refund.

const getInvoiceAction = vi.fn();
const voidInvoiceAction = vi.fn();
vi.mock("@/lib/actions/invoices", () => ({
  getInvoiceAction: (...args: unknown[]) => getInvoiceAction(...args),
  voidInvoiceAction: (...args: unknown[]) => voidInvoiceAction(...args),
}));

const listInvoicePaymentsAction = vi.fn();
const recordPaymentAction = vi.fn();
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: (...args: unknown[]) =>
    listInvoicePaymentsAction(...args),
  recordPaymentAction: (...args: unknown[]) => recordPaymentAction(...args),
}));

const listPaymentReversalsAction = vi.fn();
const reversePaymentAction = vi.fn();
vi.mock("@/lib/actions/payment-reversals", () => ({
  listPaymentReversalsAction: (...args: unknown[]) =>
    listPaymentReversalsAction(...args),
  reversePaymentAction: (...args: unknown[]) => reversePaymentAction(...args),
}));

import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";

const INVOICE = {
  id: "inv-1",
  invoiceNumber: "INV/2026-27/0001",
  financialYear: "2026-27",
  documentKind: "bill_of_supply",
  issuedOn: "2026-09-01",
  dueOn: "2026-09-10",
  subtotalPaise: 250000,
  taxPaise: 0,
  totalPaise: 250000,
  paidPaise: 100000,
  outstandingPaise: 150000,
  status: "partial",
  source: "membership",
  gstin: null,
  locationId: "loc-1",
  locationName: "Main",
  subscriptionId: "sub-1",
  activityName: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  memberId: "member-1",
  memberName: "Audit Child",
  lines: [],
};

const PAYMENT = {
  id: "pay-1",
  invoiceId: "inv-1",
  invoiceNumber: "INV/2026-27/0001",
  amountPaise: 100000,
  method: "cash",
  channel: "counter",
  reference: null,
  status: "captured",
  receivedAt: "2026-09-21T10:00:00.000Z",
  receivedByName: "Reception",
  locationName: "Main",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  getInvoiceAction.mockResolvedValue(INVOICE);
  listInvoicePaymentsAction.mockResolvedValue([PAYMENT]);
  listPaymentReversalsAction.mockResolvedValue([]);
}

describe("InvoiceExpanded reversals (PR2-C9)", () => {
  it("reverses a captured payment with a reason", async () => {
    setup();
    reversePaymentAction.mockResolvedValue({
      ok: true,
      id: "rev-1",
      invoiceStatus: "issued",
    });
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        onChanged={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /reverse/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate cash entry" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm reversal/i }));

    expect(reversePaymentAction).toHaveBeenCalledWith({
      paymentId: "pay-1",
      amountPaise: 100000,
      reason: "Duplicate cash entry",
    });
  });

  it("requires a reason before calling the action", async () => {
    setup();
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        onChanged={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /reverse/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm reversal/i }));

    expect(reversePaymentAction).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/reason/i);
  });

  it("shows existing reversals and hides the action without payments.refund", async () => {
    setup();
    listPaymentReversalsAction.mockResolvedValue([
      {
        id: "rev-1",
        amountPaise: 40000,
        reason: "Duplicate cash entry",
        reversedAt: "2026-09-21T11:00:00.000Z",
      },
    ]);
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund={false}
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByText(/Duplicate cash entry/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/₹400\.00 reversed/);
    expect(screen.queryByRole("button", { name: /reverse/i })).toBeNull();
  });
});
