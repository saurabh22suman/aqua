// @vitest-environment jsdom
//
// F01 durable recovery — the server-backed first-read gate and the
// explicit Retry/New choices, exercised through the real reception form.
//
// These are acceptance cases for the approved durable UI (the new
// recovery seam); they are added after the core patch and are not
// claimed as pre-edit RED. The pre-edit RED for the existing public
// writer lives in f01-durable-recovery.pre-edit-red.test.ts.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.stubGlobal("crypto", { randomUUID });

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

const listPaymentRecoveryAction = vi.fn();
const cancelPaymentRecoveryAction = vi.fn();
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

const EMPTY = { open: null, lastCommitted: null };
const LAST = {
  intentId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  committedAt: "2026-10-29T10:00:00.000Z",
  resultId: "33333333-3333-4333-8333-333333333333",
  invoiceStatus: "issued" as const,
};
const OPEN = {
  intentId: "44444444-4444-4444-8444-444444444444",
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
  createdAt: "2026-10-29T10:05:00.000Z",
};

const RECORDED = {
  ok: true,
  id: "pay-1",
  invoiceStatus: "paid",
  replayed: false,
};

function recordButton() {
  return screen
    .getAllByRole("button", {
      name: /record payment|continue earlier attempt|retry the same payment|record a separate payment|choose a recovery option first/i,
    })
    .at(0) as HTMLButtonElement;
}

async function pickInvoice() {
  fireEvent.change(screen.getByLabelText(/find member/i), {
    target: { value: "Audit" },
  });
  fireEvent.click(screen.getByRole("button", { name: /search/i }));
  fireEvent.click(await screen.findByTestId("payment-member-member-1"));
  await screen.findByTestId("payment-invoice-inv-1");
  fireEvent.click(screen.getByTestId("payment-invoice-inv-1"));
}

async function waitForReady() {
  await waitFor(() => expect(recordButton().disabled).toBe(false));
}

beforeEach(() => {
  window.sessionStorage.clear();
  listMembersAction.mockResolvedValue([MEMBER]);
  listMemberInvoicesAction.mockResolvedValue([INVOICE]);
  listPaymentRecoveryAction.mockResolvedValue(EMPTY);
  cancelPaymentRecoveryAction.mockResolvedValue({
    ok: true,
    intentId: OPEN.intentId,
    replayed: false,
  });
  recordPaymentAction.mockResolvedValue(RECORDED);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("F01 durable recovery — first-read gate", () => {
  it("sends no request and disables submit while the first read is unresolved", async () => {
    listPaymentRecoveryAction.mockReturnValue(new Promise(() => {}));
    render(<PaymentRecordForm />);
    await pickInvoice();

    expect(
      await screen.findByText(/Checking for an earlier attempt/i),
    ).toBeTruthy();
    expect(recordButton().disabled).toBe(true);
    expect(recordPaymentAction).not.toHaveBeenCalled();

    fireEvent.click(recordButton());
    expect(recordPaymentAction).not.toHaveBeenCalled();
  });

  it("blocks submit on a failed read and offers Retry check, never Record anyway", async () => {
    listPaymentRecoveryAction.mockRejectedValue(new Error("network"));
    render(<PaymentRecordForm />);
    await pickInvoice();

    expect(
      await screen.findByText(/Could not check for an earlier attempt/i),
    ).toBeTruthy();
    expect(recordButton().disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Retry check/i })).toBeTruthy();
    expect(screen.queryByText(/Record anyway/i)).toBeNull();

    fireEvent.click(recordButton());
    expect(recordPaymentAction).not.toHaveBeenCalled();
  });

  it("surfaces an ambiguous chain and blocks a new operation", async () => {
    listPaymentRecoveryAction.mockResolvedValue({
      open: null,
      lastCommitted: null,
      ambiguous: true,
    });
    render(<PaymentRecordForm />);
    await pickInvoice();

    expect(
      await screen.findByTestId("payment-recovery-ambiguous"),
    ).toBeTruthy();
    expect(
      screen.getByText(/earlier payment records for this invoice conflict/i),
    ).toBeTruthy();
    expect(screen.getByText(/manual resolution outside this screen/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/forked|cycled|administrator/i);
    expect(recordButton().disabled).toBe(true);
    fireEvent.click(recordButton());
    expect(recordPaymentAction).not.toHaveBeenCalled();
  });

  it("replaces a stale-refresh message with the ambiguity message after the re-read", async () => {
    listPaymentRecoveryAction
      .mockResolvedValueOnce({ open: null, lastCommitted: null })
      .mockResolvedValue({
        open: null,
        lastCommitted: null,
        ambiguous: true,
      });
    recordPaymentAction.mockResolvedValue({
      ok: false,
      error: "The document changed since it was checked. Refresh and choose again.",
      conflict: "stale_observation",
    });
    render(<PaymentRecordForm />);
    await pickInvoice();
    await waitForReady();

    fireEvent.click(recordButton());
    expect(
      await screen.findByText(/earlier payment records for this invoice conflict/i),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Refresh and choose again/i);
  });

  it("enables submit only after a successful empty read and sends a new key", async () => {
    render(<PaymentRecordForm />);
    await pickInvoice();
    await waitForReady();

    fireEvent.click(recordButton());
    await waitFor(() => expect(recordPaymentAction).toHaveBeenCalledTimes(1));
    const payload = recordPaymentAction.mock.calls[0][0] as {
      idempotencyKey?: unknown;
      observedIntentId?: unknown;
    };
    expect(typeof payload.idempotencyKey).toBe("string");
    expect(payload.observedIntentId).toBeNull();
  });
});

describe("F01 durable recovery — explicit choices", () => {
  it("continues the server's open attempt with its key", async () => {
    listPaymentRecoveryAction.mockResolvedValue({
      open: OPEN,
      lastCommitted: null,
    });
    render(<PaymentRecordForm />);
    await pickInvoice();

    expect(
      await screen.findByText(/An earlier attempt on this document/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/does not reload the earlier amount, method or reference/i),
    ).toBeTruthy();
    expect(screen.getByText(/changed details are refused/i)).toBeTruthy();
    expect(
      screen.getByText(/Re-enter the same details to continue/i),
    ).toBeTruthy();
    await waitFor(() => expect(recordButton().disabled).toBe(false));
    expect(recordButton().textContent).toMatch(/Continue earlier attempt/i);

    fireEvent.click(recordButton());
    await waitFor(() => expect(recordPaymentAction).toHaveBeenCalledTimes(1));
    const payload = recordPaymentAction.mock.calls[0][0] as {
      idempotencyKey?: unknown;
      observedIntentId?: unknown;
    };
    expect(payload.idempotencyKey).toBe(OPEN.idempotencyKey);
    expect(payload.observedIntentId).toBeNull();
  });

  it("retries the last committed operation only after the explicit choice", async () => {
    listPaymentRecoveryAction.mockResolvedValue({
      open: null,
      lastCommitted: LAST,
    });
    render(<PaymentRecordForm />);
    await pickInvoice();

    expect(
      await screen.findByText(/Your last recorded payment/i),
    ).toBeTruthy();
    expect(screen.getByText(/application timestamp/i)).toBeTruthy();
    expect(recordButton().disabled).toBe(true);
    expect(recordButton().textContent).toMatch(/Choose a recovery option first/i);

    fireEvent.click(
      screen.getByRole("button", { name: /Retry the same payment/i }),
    );
    await waitFor(() => expect(recordButton().disabled).toBe(false));
    fireEvent.click(recordButton());

    await waitFor(() => expect(recordPaymentAction).toHaveBeenCalledTimes(1));
    const payload = recordPaymentAction.mock.calls[0][0] as {
      idempotencyKey?: unknown;
      observedIntentId?: unknown;
    };
    expect(payload.idempotencyKey).toBe(LAST.idempotencyKey);
    expect(payload.observedIntentId).toBe(LAST.intentId);
  });

  it("records a new operation only after confirmation, with a new key and the observed id", async () => {
    listPaymentRecoveryAction.mockResolvedValue({
      open: null,
      lastCommitted: LAST,
    });
    render(<PaymentRecordForm />);
    await pickInvoice();

    expect(
      await screen.findByText(/Your last recorded payment/i),
    ).toBeTruthy();
    expect(recordButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Record a separate payment/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm new operation/i }));
    await waitFor(() => expect(recordButton().disabled).toBe(false));
    expect(recordButton().textContent).toMatch(/Record a separate payment/i);

    fireEvent.click(recordButton());

    await waitFor(() => expect(recordPaymentAction).toHaveBeenCalledTimes(1));
    const payload = recordPaymentAction.mock.calls[0][0] as {
      idempotencyKey?: unknown;
      observedIntentId?: unknown;
    };
    expect(typeof payload.idempotencyKey).toBe("string");
    expect(payload.idempotencyKey).not.toBe(LAST.idempotencyKey);
    expect(payload.observedIntentId).toBe(LAST.intentId);
  });
});
