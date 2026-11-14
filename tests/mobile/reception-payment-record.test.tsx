// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR2-C3 — the reception payment screen must RECORD a counter payment,
// not just display a QR: search a member, pick an open invoice, take
// cash or UPI (reference required), and show the updated balance.

const listMembersAction = vi.fn();
vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

const listMemberInvoicesAction = vi.fn();
vi.mock("@/lib/actions/invoices", () => ({
  listMemberInvoicesAction: (...args: unknown[]) =>
    listMemberInvoicesAction(...args),
}));

const recordPaymentAction = vi.fn();
vi.mock("@/lib/actions/payments", () => ({
  recordPaymentAction: (...args: unknown[]) => recordPaymentAction(...args),
}));
const listPaymentRecoveryAction = vi.hoisted(() => vi.fn(async () => ({ open: null, lastCommitted: null })));
vi.mock("@/lib/actions/payment-intents", () => ({
  listPaymentRecoveryAction,
  cancelPaymentRecoveryAction: vi.fn(),
}));

import { PaymentRecordForm } from "@/components/payment-record-form";

const MEMBER = {
  memberId: "member-1",
  fullName: "Audit Child",
  memberCode: "MEM-0001",
  phone: "+919900000001",
};

const INVOICE = {
  id: "inv-1",
  invoiceNumber: "INV/2026-27/0001",
  totalPaise: 250000,
  paidPaise: 0,
  outstandingPaise: 250000,
  status: "issued",
  dueOn: "2026-09-10",
  issuedOn: "2026-09-01",
  subscriptionId: "sub-1",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listPaymentRecoveryAction.mockReset();
  listPaymentRecoveryAction.mockResolvedValue({ open: null, lastCommitted: null });
});

async function pickMemberAndInvoice() {
  listMembersAction.mockResolvedValue([MEMBER]);
  listMemberInvoicesAction.mockResolvedValue([INVOICE]);

  fireEvent.change(screen.getByLabelText(/find member/i), {
    target: { value: "Audit" },
  });
  fireEvent.click(screen.getByRole("button", { name: /search/i }));
  fireEvent.click(await screen.findByTestId("payment-member-member-1"));
  await screen.findByTestId("payment-invoice-inv-1");
  fireEvent.click(screen.getByTestId("payment-invoice-inv-1"));
}

// Recovery readiness, not elapsed time, determines whether a payment click is accepted.
async function clickReadyRecordPayment() {
  const button = screen.getByRole("button", { name: /record payment/i });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
}

describe("PaymentRecordForm (PR2-C3)", () => {
  it("retries the recorded payment with its original key and observed intent", async () => {
    const key = "11111111-1111-4111-8111-111111111111";
    const intentId = "22222222-2222-4222-8222-222222222222";
    listPaymentRecoveryAction.mockResolvedValue({ open: null, lastCommitted: {
      intentId, idempotencyKey: key, committedAt: "2026-09-21T11:00:00Z", resultId: "pay-1", invoiceStatus: "partial",
    } } as never);
    recordPaymentAction.mockResolvedValue({ ok: true, id: "pay-1", invoiceStatus: "partial" });
    render(<PaymentRecordForm />);
    await pickMemberAndInvoice();
    fireEvent.click(await screen.findByRole("button", { name: "Retry the same payment" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Retry the same payment" })[0]!);
    await waitFor(() => expect(recordPaymentAction).toHaveBeenCalledWith({
      invoiceId: "inv-1", amountPaise: 250000, method: "cash", idempotencyKey: key, observedIntentId: intentId,
    }));
  });
  it("searches a member, lists open invoices and records cash", async () => {
    recordPaymentAction.mockResolvedValue({
      ok: true,
      id: "pay-1",
      invoiceStatus: "paid",
    });
    render(<PaymentRecordForm />);

    await pickMemberAndInvoice();
    expect(document.body.textContent).toMatch(/₹2,500\.00 outstanding/);

    await clickReadyRecordPayment();

    await waitFor(() => expect(recordPaymentAction).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      amountPaise: 250000,
      method: "cash",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      observedIntentId: null,
    }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Payment recorded. Invoice is now paid.",
    );
  });

  it("requires a UPI reference before submitting", async () => {
    render(<PaymentRecordForm />);
    await pickMemberAndInvoice();

    fireEvent.click(screen.getByRole("radio", { name: /upi/i }));
    await clickReadyRecordPayment();

    expect(recordPaymentAction).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/reference/i);

    fireEvent.change(screen.getByLabelText(/upi reference/i), {
      target: { value: "UTR-42" },
    });
    recordPaymentAction.mockResolvedValue({
      ok: true,
      id: "pay-2",
      invoiceStatus: "partial",
    });
    await clickReadyRecordPayment();

    await waitFor(() => expect(recordPaymentAction).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      amountPaise: 250000,
      method: "upi",
      reference: "UTR-42",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      observedIntentId: null,
    }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Payment recorded. Invoice is now partially paid.",
    );
  });

  it("shows the server's refusal without losing the selection", async () => {
    recordPaymentAction.mockResolvedValue({
      ok: false,
      error: "That is more than the outstanding balance of ₹2,500.00.",
    });
    render(<PaymentRecordForm />);
    await pickMemberAndInvoice();

    await clickReadyRecordPayment();

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "That is more than the outstanding balance of ₹2,500.00.",
    );
    expect(screen.getByTestId("payment-invoice-inv-1")).toBeTruthy();
  });
});
