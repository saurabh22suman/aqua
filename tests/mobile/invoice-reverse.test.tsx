// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.stubGlobal("crypto", { randomUUID });

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
const listReversalRecoveryAction = vi.fn<
  (...args: unknown[]) => Promise<PaymentIntentRecovery>
>(async () => ({
  open: null,
  lastCommitted: null,
}));
const cancelReversalRecoveryAction = vi.fn<
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
  listReversalRecoveryAction: (...args: unknown[]) =>
    listReversalRecoveryAction(...args),
  cancelReversalRecoveryAction: (...args: unknown[]) =>
    cancelReversalRecoveryAction(...args),
}));

vi.mock("@/lib/actions/payment-qrs", () => ({
  listPaymentQrsAction: vi.fn(async () => []),
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
  listPaymentRecoveryAction.mockResolvedValue({
    open: null,
    lastCommitted: null,
  });
  listReversalRecoveryAction.mockResolvedValue({
    open: null,
    lastCommitted: null,
  });
}

async function waitForEnabled(name: RegExp) {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
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
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await screen.findByRole("button", { name: /reverse/i });
    await waitForEnabled(/reverse/i);
    fireEvent.click(screen.getByRole("button", { name: /reverse/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate cash entry" },
    });
    await waitForEnabled(/confirm reversal/i);
    fireEvent.click(screen.getByRole("button", { name: /confirm reversal/i }));

    expect(reversePaymentAction).toHaveBeenCalledWith({
      paymentId: "pay-1",
      amountPaise: 100000,
      reason: "Duplicate cash entry",
      // F01 — the public action carries a one-time operation key, so a
      // retry of the same reversal cannot take the money back twice.
      idempotencyKey: expect.any(String),
      observedIntentId: null,
    });
  });

  it("disables a new reversal and explains an ambiguous reversal record", async () => {
    setup();
    listReversalRecoveryAction.mockResolvedValue({
      open: null,
      lastCommitted: null,
      ambiguous: true,
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await screen.findByRole("button", { name: /reverse/i });
    await waitForEnabled(/reverse/i);
    fireEvent.click(screen.getByRole("button", { name: /reverse/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate cash entry" },
    });

    const notice = await screen.findByTestId("payment-recovery-ambiguous");
    expect(notice.textContent).toMatch(/earlier reversal records for this payment conflict/i);
    expect(notice.textContent).toMatch(/manual resolution outside this screen/i);
    expect(notice.textContent).not.toMatch(/forked|cycled|administrator/i);

    const confirm = screen.getByRole("button", {
      name: /confirm reversal/i,
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(reversePaymentAction).not.toHaveBeenCalled();
  });

  it("does not submit a new reversal after the recovery read finds an ambiguous chain", async () => {
    setup();
    // The first read is clean, so the form is ready. The mutation then hits
    // the server's ambiguous-chain refusal and the re-read explains it.
    listReversalRecoveryAction
      .mockResolvedValueOnce({ open: null, lastCommitted: null })
      .mockResolvedValue({
        open: null,
        lastCommitted: null,
        ambiguous: true,
      });
    reversePaymentAction.mockResolvedValue({
      ok: false,
      error: "The document changed since it was checked. Refresh and choose again.",
      conflict: "stale_observation",
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await screen.findByRole("button", { name: /reverse/i });
    await waitForEnabled(/reverse/i);
    fireEvent.click(screen.getByRole("button", { name: /reverse/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate cash entry" },
    });
    await waitForEnabled(/confirm reversal/i);
    fireEvent.click(screen.getByRole("button", { name: /confirm reversal/i }));

    expect(
      await screen.findByText(/earlier reversal records for this payment conflict/i),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Refresh and choose again/i);
  });

  it("warns that earlier reversal details are not reloaded and changed details are refused", async () => {
    setup();
    listReversalRecoveryAction.mockResolvedValue({
      open: {
        intentId: "99999999-9999-4999-8999-999999999999",
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        createdAt: "2026-10-29T10:05:00.000Z",
      },
      lastCommitted: null,
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await screen.findByRole("button", { name: /reverse/i });
    await waitForEnabled(/reverse/i);
    fireEvent.click(screen.getByRole("button", { name: /reverse/i }));

    expect(
      await screen.findByText(/does not reload the earlier amount or reason/i),
    ).toBeTruthy();
    expect(screen.getByText(/changed details are refused/i)).toBeTruthy();
  });

  it("releases the shared busy state after a saved reversal even if the recovery re-read hangs", async () => {
    setup();
    reversePaymentAction.mockResolvedValue({
      ok: true,
      id: "rev-1",
      invoiceStatus: "partial",
    });
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );
    await screen.findByRole("button", { name: /reverse/i });
    await waitForEnabled(/reverse/i);
    fireEvent.click(screen.getByRole("button", { name: /reverse/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate cash entry" },
    });
    await waitForEnabled(/confirm reversal/i);
    await waitFor(() => expect(listReversalRecoveryAction).toHaveBeenCalled());

    listReversalRecoveryAction.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: /confirm reversal/i }));

    expect(await screen.findByText("Reversal saved.")).toBeTruthy();
    // The shared busy state must be released: the owner payment form must not
    // stay on "Saving…" because a recovery re-read is still pending.
    await waitFor(() => expect(screen.queryByText(/Saving…/)).toBeNull());
    const record = await screen.findByRole("button", {
      name: /record payment/i,
    });
    expect((record as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not add a reconciliation warning when the invoice reload was superseded", async () => {
    setup();
    getInvoiceAction.mockImplementation(async (id: unknown) =>
      id === "inv-2"
        ? {
            ...INVOICE,
            status: "partial",
            paidPaise: 100000,
            outstandingPaise: 150000,
          }
        : { ...INVOICE, status: "paid", paidPaise: 250000, outstandingPaise: 0 },
    );
    listPaymentRecoveryAction.mockResolvedValue({
      open: CLOSED_OPEN,
      lastCommitted: null,
    });
    cancelPaymentRecoveryAction.mockResolvedValue({
      ok: false,
      error: "Attempt not found.",
    });

    const { rerender } = render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );
    await screen.findByTestId("closed-intent-recovery");

    let resolveHangingReload: ((value: unknown) => void) | undefined;
    getInvoiceAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHangingReload = resolve;
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /discard earlier attempt/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm discard/i }));
    await waitFor(() => expect(getInvoiceAction).toHaveBeenCalledTimes(2));

    // A newer invoice takes over the panel while the reload after the refused
    // discard is still hanging, so that reload is superseded, not failed.
    rerender(
      <InvoiceExpanded
        invoiceId="inv-2"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );
    await screen.findByRole("button", { name: /record payment/i });
    resolveHangingReload!(INVOICE);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryAllByText(/could not be discarded/i)).toHaveLength(0);
  });

  it("requires a reason before calling the action", async () => {
    setup();
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await screen.findByRole("button", { name: /reverse/i });
    await waitForEnabled(/reverse/i);
    fireEvent.click(screen.getByRole("button", { name: /reverse/i }));
    await waitForEnabled(/confirm reversal/i);
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
        canReadPayments
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByText(/Duplicate cash entry/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/₹400\.00 reversed/);
    expect(screen.queryByRole("button", { name: /reverse/i })).toBeNull();
  });

  it("loads the invoice for a receptionist without payments.read and never calls the reversal read", async () => {
    setup();
    listPaymentReversalsAction.mockRejectedValue(
      new Error("Missing permission: payments.read"),
    );

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

    expect(await screen.findByText(/Record a payment/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /receipt/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Could not load this invoice/);
    expect(listPaymentReversalsAction).not.toHaveBeenCalled();
  });
});

describe("InvoiceExpanded failure recovery (FE-04)", () => {
  it("releases the record-payment busy state and reconciles after a thrown transport error", async () => {
    setup();
    recordPaymentAction.mockRejectedValueOnce(new Error("Failed to fetch"));

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    const button = await screen.findByRole("button", { name: /record payment/i });
    await waitForEnabled(/record payment/i);
    fireEvent.click(button);

    await screen.findByText(/did not complete/i);
    await waitForEnabled(/record payment/i);
    expect(getInvoiceAction).toHaveBeenCalledTimes(2);
    expect(
      (screen.getByRole("button", { name: /record payment/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(document.body.textContent).not.toMatch(/Saving…/);
  });

  it("keeps the saved outcome visible when the post-save load fails", async () => {
    setup();
    recordPaymentAction.mockResolvedValue({
      ok: true,
      id: "pay-2",
      invoiceStatus: "paid",
      replayed: false,
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await waitForEnabled(/record payment/i);
    // The action succeeds; only the follow-up load fails. The operator must
    // still see the outcome the server already committed.
    getInvoiceAction.mockRejectedValueOnce(new Error("reload failed"));
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(screen.getByText(/Could not load this invoice/i)).toBeTruthy();
  });

  it("keeps the saved reversal outcome visible when the post-save load fails", async () => {
    setup();
    reversePaymentAction.mockResolvedValue({
      ok: true,
      id: "rev-1",
      invoiceStatus: "partial",
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await screen.findByRole("button", { name: /reverse/i });
    await waitForEnabled(/reverse/i);
    fireEvent.click(screen.getByRole("button", { name: /reverse/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate cash entry" },
    });
    await waitForEnabled(/confirm reversal/i);
    // The action succeeds; only the follow-up load fails. The operator must
    // still see the outcome the server already committed.
    getInvoiceAction.mockRejectedValueOnce(new Error("reload failed"));
    fireEvent.click(screen.getByRole("button", { name: /confirm reversal/i }));

    expect(await screen.findByText(/Reversal saved/i)).toBeTruthy();
    expect(screen.getByText(/Could not load this invoice/i)).toBeTruthy();
  });

  it("keeps the unknown reversal outcome visible when the follow-up load also fails", async () => {
    setup();
    reversePaymentAction.mockRejectedValueOnce(new Error("Failed to fetch"));

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await screen.findByRole("button", { name: /reverse/i });
    await waitForEnabled(/reverse/i);
    fireEvent.click(screen.getByRole("button", { name: /reverse/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate cash entry" },
    });
    await waitForEnabled(/confirm reversal/i);
    getInvoiceAction.mockRejectedValueOnce(new Error("reload failed"));
    fireEvent.click(screen.getByRole("button", { name: /confirm reversal/i }));

    expect(await screen.findByText(/did not complete/i)).toBeTruthy();
    expect(screen.getByText(/Could not load this invoice/i)).toBeTruthy();
  });

  it("shows the saved payment and reloads before a slow recovery read resolves", async () => {
    setup();
    recordPaymentAction.mockResolvedValue({
      ok: true,
      id: "pay-2",
      invoiceStatus: "paid",
      replayed: false,
    });
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );
    await waitForEnabled(/record payment/i);
    await waitFor(() => expect(listPaymentRecoveryAction).toHaveBeenCalled());

    listPaymentRecoveryAction.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(getInvoiceAction).toHaveBeenCalledTimes(2);
  });

  it("shows a reversal refusal before a slow recovery re-read resolves", async () => {
    setup();
    reversePaymentAction.mockResolvedValue({
      ok: false,
      error: "The reversal was refused.",
    });
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );
    await screen.findByRole("button", { name: /reverse/i });
    await waitForEnabled(/reverse/i);
    fireEvent.click(screen.getByRole("button", { name: /reverse/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate cash entry" },
    });
    await waitForEnabled(/confirm reversal/i);
    await waitFor(() => expect(listReversalRecoveryAction).toHaveBeenCalled());

    listReversalRecoveryAction.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: /confirm reversal/i }));

    expect(await screen.findByText("The reversal was refused.")).toBeTruthy();
  });

  it("releases the reversal busy state and reconciles after a thrown transport error", async () => {
    setup();
    reversePaymentAction.mockRejectedValueOnce(new Error("Failed to fetch"));

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await screen.findByRole("button", { name: /reverse/i });
    await waitForEnabled(/reverse/i);
    fireEvent.click(screen.getByRole("button", { name: /reverse/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate cash entry" },
    });
    await waitForEnabled(/confirm reversal/i);
    fireEvent.click(screen.getByRole("button", { name: /confirm reversal/i }));

    await screen.findByText(/did not complete/i);
    await waitForEnabled(/confirm reversal/i);
    expect(
      (
        screen.getByRole("button", {
          name: /confirm reversal/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

const CLOSED_OPEN = {
  intentId: "66666666-6666-4666-8666-666666666666",
  idempotencyKey: "77777777-7777-4777-8777-777777777777",
  createdAt: "2026-10-29T10:15:00.000Z",
};

describe("InvoiceExpanded closed-target recovery", () => {
  it("does not show the closed-invoice discard to a viewer on an open invoice", async () => {
    setup();
    listPaymentRecoveryAction.mockResolvedValue({
      open: CLOSED_OPEN,
      lastCommitted: null,
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite={false}
        canRecord={false}
        canRefund={false}
        canReadPayments
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByText("Partially paid")).toBeTruthy();
    expect(screen.queryByTestId("closed-intent-recovery")).toBeNull();
    expect(screen.queryByText(/closed invoice/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /discard earlier attempt/i }),
    ).toBeNull();
  });

  it("does not offer discard without the cancel permission on a closed invoice", async () => {
    setup();
    getInvoiceAction.mockResolvedValue({
      ...INVOICE,
      status: "paid",
      paidPaise: 250000,
      outstandingPaise: 0,
    });
    listPaymentRecoveryAction.mockResolvedValue({
      open: CLOSED_OPEN,
      lastCommitted: null,
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite={false}
        canRecord={false}
        canRefund={false}
        canReadPayments
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByText("Paid")).toBeTruthy();
    expect(screen.queryByTestId("closed-intent-recovery")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /discard earlier attempt/i }),
    ).toBeNull();
    expect(cancelPaymentRecoveryAction).not.toHaveBeenCalled();
  });

  it("blocks a new owner payment and explains an ambiguous payment record", async () => {
    setup();
    listPaymentRecoveryAction.mockResolvedValue({
      open: null,
      lastCommitted: null,
      ambiguous: true,
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    const notice = await screen.findByTestId("payment-recovery-ambiguous");
    expect(notice.textContent).toMatch(/earlier payment records for this invoice conflict/i);
    expect(notice.textContent).toMatch(/manual resolution outside this screen/i);
    const record = screen.getByRole("button", { name: /record payment/i }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.click(record);
    expect(recordPaymentAction).not.toHaveBeenCalled();
  });

  it("discloses an ambiguous chain on a closed target with an open attempt", async () => {
    setup();
    getInvoiceAction.mockResolvedValue({
      ...INVOICE,
      status: "paid",
      paidPaise: 250000,
      outstandingPaise: 0,
    });
    listPaymentRecoveryAction.mockResolvedValue({
      open: CLOSED_OPEN,
      lastCommitted: null,
      ambiguous: true,
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByTestId("closed-intent-recovery")).toBeTruthy();
    const notice = await screen.findByTestId("payment-recovery-ambiguous");
    expect(notice.textContent).toMatch(/earlier payment records for this invoice conflict/i);
    expect(screen.getByText(/when checked/i)).toBeTruthy();
  });

  it("offers only a bounded discard for a prepared intent on a closed invoice", async () => {
    setup();
    getInvoiceAction.mockResolvedValue({
      ...INVOICE,
      status: "paid",
      paidPaise: 250000,
      outstandingPaise: 0,
    });
    listPaymentRecoveryAction.mockResolvedValue({
      open: CLOSED_OPEN,
      lastCommitted: null,
    });
    cancelPaymentRecoveryAction.mockResolvedValue({
      ok: true,
      intentId: CLOSED_OPEN.intentId,
      replayed: false,
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByTestId("closed-intent-recovery")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /record payment/i })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /discard earlier attempt/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm discard/i }));
    await waitFor(() =>
      expect(cancelPaymentRecoveryAction).toHaveBeenCalledWith({
        intentId: CLOSED_OPEN.intentId,
      }),
    );
  });

  it("rechecks and reconciles when a commit landed after the closed-target read", async () => {
    setup();
    getInvoiceAction.mockResolvedValue({
      ...INVOICE,
      status: "paid",
      paidPaise: 250000,
      outstandingPaise: 0,
    });
    listPaymentRecoveryAction
      .mockResolvedValueOnce({
        open: CLOSED_OPEN,
        lastCommitted: null,
      })
      .mockResolvedValue({
        open: null,
        lastCommitted: {
          intentId: CLOSED_OPEN.intentId,
          idempotencyKey: CLOSED_OPEN.idempotencyKey,
          committedAt: "2026-10-29T10:20:00.000Z",
          resultId: "88888888-8888-4888-8888-888888888888",
          invoiceStatus: "paid",
        },
      });
    cancelPaymentRecoveryAction.mockResolvedValue({
      ok: false,
      error: "This attempt already recorded money; it cannot be discarded.",
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByTestId("closed-intent-recovery")).toBeTruthy();
    expect(screen.getByText(/when checked/i)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /discard earlier attempt/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm discard/i }));

    await waitFor(() =>
      expect(listPaymentRecoveryAction).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByTestId("closed-intent-result")).toBeTruthy();
    expect(screen.getByText(/could not be discarded/i)).toBeTruthy();
    expect(screen.queryByTestId("closed-intent-recovery")).toBeNull();
    expect(getInvoiceAction).toHaveBeenCalledTimes(2);
  });

  it("rechecks after a discard is refused because the location scope changed", async () => {
    setup();
    getInvoiceAction.mockResolvedValue({
      ...INVOICE,
      status: "paid",
      paidPaise: 250000,
      outstandingPaise: 0,
    });
    listPaymentRecoveryAction
      .mockResolvedValueOnce({
        open: CLOSED_OPEN,
        lastCommitted: null,
      })
      .mockResolvedValue({
        open: null,
        lastCommitted: null,
      });
    cancelPaymentRecoveryAction.mockResolvedValue({
      ok: false,
      error: "Attempt not found.",
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByTestId("closed-intent-recovery")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /discard earlier attempt/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm discard/i }));

    await waitFor(() =>
      expect(listPaymentRecoveryAction).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByTestId("closed-intent-result")).toBeTruthy();
    expect(screen.getByText(/could not be discarded/i)).toBeTruthy();
    expect(screen.queryByTestId("closed-intent-recovery")).toBeNull();
  });

  it("does not expose recovery data when the location scope is revoked", async () => {
    setup();
    getInvoiceAction.mockResolvedValue({
      ...INVOICE,
      status: "paid",
      paidPaise: 250000,
      outstandingPaise: 0,
    });
    listPaymentRecoveryAction.mockResolvedValue({
      open: null,
      lastCommitted: null,
    });

    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByText("Paid")).toBeTruthy();
    expect(screen.queryByTestId("closed-intent-recovery")).toBeNull();
    expect(cancelPaymentRecoveryAction).not.toHaveBeenCalled();
  });
});
