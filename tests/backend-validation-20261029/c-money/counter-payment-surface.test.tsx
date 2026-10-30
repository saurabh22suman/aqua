// @vitest-environment jsdom
//
// Lane c-money — the counter payment surface (F-10) and the invoice
// panel's disclosure when the caller cannot read reversals (F-01).
//
// F-10: the server has always accepted cash, UPI, bank transfer, card
// and "other" (lib/services/payments.ts, the payments_method_check
// constraint and lib/money/payment-groups.ts, the one mapping the
// owner's doughnut, its drill-down and the Fees filter share). The
// café panel already offered card and other. The two MEMBERSHIP
// payment forms offered cash and UPI only — so a card-terminal or
// bank-transfer collection at the membership counter could not be
// recorded honestly: it had to be booked as cash (inflating the cash
// figure and the cash count) or as UPI with a reference that was never
// issued.
//
// F-01: a receptionist holds invoices.read but NOT payments.read, so
// the panel never loaded the reversals. After a reversal the invoice's
// paid figure (which the reversal DID reduce) was shown next to the
// full payment list, with nothing explaining the gap. The disclosure
// below is derived only from what that role can already read — the
// payment list and the invoice's own totals — and grants nothing new.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.stubGlobal("crypto", { randomUUID });

const MEMBER = {
  memberId: "m1",
  fullName: "Member One",
  memberCode: "M-1",
};
const INVOICE = {
  id: "inv-1",
  invoiceNumber: "INV/2026-27/0001",
  financialYear: "2026-27",
  documentKind: "Bill of Supply",
  issuedOn: "2026-10-01",
  dueOn: "2026-10-10",
  subtotalPaise: 100000,
  taxPaise: 0,
  totalPaise: 100000,
  paidPaise: 0,
  outstandingPaise: 100000,
  status: "issued",
  source: "membership",
  gstin: null,
  locationName: "Worli Main",
  memberId: "m1",
  memberName: "Member One",
};

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: vi.fn(async () => [MEMBER]),
}));
vi.mock("@/lib/actions/invoices", () => ({
  listMemberInvoicesAction: vi.fn(async () => [INVOICE]),
  getInvoiceAction: vi.fn(async () => DETAIL),
  voidInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: vi.fn(async () => PAYMENTS),
  recordPaymentAction: vi.fn(),
}));
vi.mock("@/lib/actions/payment-reversals", () => ({
  listPaymentReversalsAction: vi.fn(async () => []),
  reversePaymentAction: vi.fn(),
}));
vi.mock("@/lib/actions/payment-intents", () => ({
  listPaymentRecoveryAction: vi.fn(async () => ({
    open: null,
    lastCommitted: null,
  })),
  cancelPaymentRecoveryAction: vi.fn(async () => ({
    ok: true,
    intentId: "intent-1",
    replayed: false,
  })),
  listReversalRecoveryAction: vi.fn(async () => ({
    open: null,
    lastCommitted: null,
  })),
  cancelReversalRecoveryAction: vi.fn(async () => ({
    ok: true,
    intentId: "intent-1",
    replayed: false,
  })),
}));

vi.mock("@/lib/actions/payment-qrs", () => ({
  listPaymentQrsAction: vi.fn(async () => []),
}));

import { PaymentRecordForm } from "@/components/payment-record-form";
import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";
import { getInvoiceAction } from "@/lib/actions/invoices";
import { listInvoicePaymentsAction } from "@/lib/actions/payments";
import type { InvoiceDetail } from "@/lib/services/invoices";
import type { PaymentRow } from "@/lib/services/payments";

const DETAIL = {
  id: "inv-1",
  invoiceNumber: "INV/2026-27/0001",
  financialYear: "2026-27",
  documentKind: "Bill of Supply",
  issuedOn: "2026-10-01",
  dueOn: "2026-10-10",
  subtotalPaise: 100000,
  taxPaise: 0,
  totalPaise: 100000,
  // The reversal reduced the invoice's paid figure to 70000.
  paidPaise: 70000,
  outstandingPaise: 30000,
  status: "partial",
  source: "membership",
  gstin: null,
  locationName: "Worli Main",
  activityName: null,
  memberId: "m1",
  memberName: "Member One",
  lines: [],
} as unknown as InvoiceDetail;

const PAYMENTS = [
  {
    id: "pay-1",
    invoiceId: "inv-1",
    invoiceNumber: "INV/2026-27/0001",
    amountPaise: 100000,
    method: "cash",
    channel: "counter",
    reference: null,
    status: "captured",
    receivedAt: "2026-10-05T10:00:00.000Z",
    receivedByName: "Desk",
    locationName: "Worli Main",
  },
] as unknown as PaymentRow[];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Restore the default payloads: clearAllMocks does not reset an
  // implementation set by a test.
  vi.mocked(getInvoiceAction).mockResolvedValue(DETAIL);
  vi.mocked(listInvoicePaymentsAction).mockResolvedValue(PAYMENTS);
});

describe("the counter can record every method the server supports (F-10)", () => {
  it("offers cash, UPI, bank transfer, card and other", async () => {
    render(<PaymentRecordForm />);

    // search → member → invoice, the journey the screen walks.
    fireEvent.change(screen.getByTestId("payment-member-search"), {
      target: { value: "Member" },
    });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.click(await screen.findByTestId("payment-member-m1"));
    fireEvent.click(await screen.findByTestId("payment-invoice-inv-1"));

    for (const name of ["Cash", "UPI", "Bank transfer", "Card", "Other"]) {
      expect(
        screen.getByRole("radio", { name }),
        `${name} is offered at the counter`,
      ).toBeTruthy();
    }
  }, 30_000);

  it("asks for the method's reference once a non-cash method is chosen", async () => {
    render(<PaymentRecordForm />);

    fireEvent.change(screen.getByTestId("payment-member-search"), {
      target: { value: "Member" },
    });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.click(await screen.findByTestId("payment-member-m1"));
    fireEvent.click(await screen.findByTestId("payment-invoice-inv-1"));

    // Cash carries no reference.
    expect(screen.queryByLabelText(/reference/i)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Card" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/card terminal reference/i)).toBeTruthy();
    });
  }, 30_000);
});

describe("the invoice panel discloses what the role cannot see (F-01)", () => {
  it("says so when the listed payments do not add up to the paid figure", async () => {
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund={false}
        canReadPayments={false}
        onChanged={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Recorded payments total/i)).toBeTruthy();
    });
    const text = document.body.textContent ?? "";
    // The disclosure explains the gap and says the detail is not
    // visible to this role — it never states the reversal's amount,
    // reason or actor.
    expect(text).toMatch(/not visible to your role/i);
    expect(text).not.toMatch(/reversed ₹|refunded/i);
  }, 30_000);

  it("says nothing when a visible non-captured row makes the list look larger", async () => {
    // The payment list carries every status (captured, pending,
    // failed). Only a CAPTURED payment moves the invoice's paid
    // figure, so a visible pending/failed row must not manufacture the
    // adjustment note.
    vi.mocked(listInvoicePaymentsAction).mockResolvedValue([
      {
        ...PAYMENTS[0],
        amountPaise: 70000,
      },
      {
        ...PAYMENTS[0],
        id: "pay-2",
        amountPaise: 100000,
        status: "failed",
      },
    ] as unknown as PaymentRow[]);

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund={false}
        canReadPayments={false}
        onChanged={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Paid/i).length).toBeGreaterThan(0);
    });
    expect(document.body.textContent ?? "").not.toMatch(
      /Recorded payments total/i,
    );
  }, 30_000);

  it("says nothing when the listed payments match the paid figure", async () => {
    vi.mocked(getInvoiceAction).mockResolvedValue({
      ...DETAIL,
      paidPaise: 100000,
      outstandingPaise: 0,
      status: "paid",
    } as unknown as InvoiceDetail);

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund={false}
        canReadPayments={false}
        onChanged={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Paid/i).length).toBeGreaterThan(0);
    });
    expect(document.body.textContent ?? "").not.toMatch(
      /Recorded payments total/i,
    );
  }, 30_000);
});
