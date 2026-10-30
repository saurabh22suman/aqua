// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.stubGlobal("crypto", { randomUUID });

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

import type {
  CancelIntentResult,
  PaymentIntentRecovery,
} from "@/lib/services/payment-intent-recovery";

const listPaymentRecoveryAction = vi.fn<
  (...args: unknown[]) => Promise<PaymentIntentRecovery>
>(async () => ({
  open: null,
  lastCommitted: null,
}));
const cancelPaymentRecoveryAction = vi.fn<
  (...args: unknown[]) => Promise<CancelIntentResult>
>(async () => ({
  ok: true,
  intentId: "intent-1",
  replayed: false,
}));
vi.mock("@/lib/actions/payment-intents", () => ({
  listPaymentRecoveryAction: (...args: unknown[]) =>
    listPaymentRecoveryAction(...args),
  cancelPaymentRecoveryAction: (...args: unknown[]) =>
    cancelPaymentRecoveryAction(...args),
}));

vi.mock("@/lib/actions/payment-qrs", () => ({
  listPaymentQrsAction: vi.fn(async () => []),
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

describe("PaymentRecordForm (PR2-C3)", () => {
  it("searches a member, lists open invoices and records cash", async () => {
    recordPaymentAction.mockResolvedValue({
      ok: true,
      id: "pay-1",
      invoiceStatus: "paid",
    });
    render(<PaymentRecordForm />);

    await pickMemberAndInvoice();
    expect(document.body.textContent).toMatch(/₹2,500\.00 outstanding/);

    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(recordPaymentAction).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      amountPaise: 250000,
      method: "cash",
      // F01 — the public action carries a one-time operation key, so a
      // retry of the same submission is one operation.
      idempotencyKey: expect.any(String),
      observedIntentId: null,
    });
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Payment recorded. Invoice is now paid.",
    );
  });

  it("requires a UPI reference before submitting", async () => {
    render(<PaymentRecordForm />);
    await pickMemberAndInvoice();

    fireEvent.click(screen.getByRole("radio", { name: /upi/i }));
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

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
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(recordPaymentAction).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      amountPaise: 250000,
      method: "upi",
      reference: "UTR-42",
      // F01 — the public action carries a one-time operation key.
      idempotencyKey: expect.any(String),
      observedIntentId: null,
    });
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Payment recorded. Invoice is now partially paid.",
    );
  });

  it("keeps the payment confirmation after a full payment removes the invoice", async () => {
    recordPaymentAction.mockResolvedValue({
      ok: true,
      id: "pay-1",
      invoiceStatus: "paid",
    });
    render(<PaymentRecordForm />);
    await pickMemberAndInvoice();

    listMemberInvoicesAction.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(
      await screen.findByText("Payment recorded. Invoice is now paid."),
    ).toBeTruthy();
    expect(screen.getByText(/No open invoices for this member/)).toBeTruthy();
  });

  it("disables the record button while a member search is pending", async () => {
    render(<PaymentRecordForm />);
    await pickMemberAndInvoice();

    listMembersAction.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.change(screen.getByLabelText(/find member/i), {
      target: { value: "Audit" },
    });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    expect(
      (screen.getByRole("button", { name: /record payment/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("disables search and invoice selection while a payment is pending", async () => {
    recordPaymentAction.mockReturnValue(new Promise(() => {}));
    render(<PaymentRecordForm />);
    await pickMemberAndInvoice();

    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(
      (screen.getByRole("button", { name: /search/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("payment-invoice-inv-1") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("clears a previous list-refresh error when the next payment starts", async () => {
    recordPaymentAction.mockResolvedValue({
      ok: true,
      id: "pay-1",
      invoiceStatus: "paid",
    });
    render(<PaymentRecordForm />);
    await pickMemberAndInvoice();

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /record payment/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    listMemberInvoicesAction.mockRejectedValueOnce(new Error("list failed"));
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    expect(
      await screen.findByText(/invoice list could not be refreshed/i),
    ).toBeTruthy();

    listMemberInvoicesAction.mockResolvedValue([INVOICE]);
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    await waitFor(() =>
      expect(screen.queryByText(/invoice list could not be refreshed/i)).toBeNull(),
    );
  });

  it("shows a refusal before a slow recovery re-read resolves", async () => {
    recordPaymentAction.mockResolvedValue({
      ok: false,
      error: "Server refusal.",
    });
    render(<PaymentRecordForm />);
    await pickMemberAndInvoice();
    await waitFor(() =>
      expect(listPaymentRecoveryAction).toHaveBeenCalled(),
    );

    listPaymentRecoveryAction.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(await screen.findByText("Server refusal.")).toBeTruthy();
  });

  it("shows the server's refusal without losing the selection", async () => {
    recordPaymentAction.mockResolvedValue({
      ok: false,
      error: "That is more than the outstanding balance of ₹2,500.00.",
    });
    render(<PaymentRecordForm />);
    await pickMemberAndInvoice();

    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "That is more than the outstanding balance of ₹2,500.00.",
    );
    expect(screen.getByTestId("payment-invoice-inv-1")).toBeTruthy();
  });
});
