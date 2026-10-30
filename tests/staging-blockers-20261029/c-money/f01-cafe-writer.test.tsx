// @vitest-environment jsdom
//
// Staging blocker F01 — the café counter writer.
//
// ACCEPTANCE REGRESSION — EXPECTED RED until the F01 change is approved
// and applied.
//
// The café panel is the THIRD public payment writer (the reception form
// and the owner invoice panel are the other two), and it had a blocking
// defect in the revision under review: its reference conditional was
// inverted, so a CASH payment sent an empty reference (the action's
// schema refuses it) and a UPI payment sent none (the service refuses
// it) — the café counter could not take a payment in any method.
//
// These cases pin the ORIGINAL behaviour that must be preserved:
//
//   - cash carries NO reference;
//   - every other method carries its reference;
//
// and the client contract the proposal defines for this writer:
//
//   - the same operation retried keeps its key (one effect);
//   - a consumed key (a conflict) keeps the record and blocks.
//
// The counter surface is mocked at the action boundary (the real
// component drives the real state machine); the reference semantics are
// asserted on the PAYLOAD the action receives.

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

import { CafePaymentPanel } from "@/components/cafe-payment-panel";

const BILL = {
  invoiceId: "inv-cafe-1",
  invoiceNumber: "INV/2026-27/0042",
  memberId: "member-1",
  memberName: "Audit Child",
  totalPaise: 26250,
  amountDuePaise: 26250,
  taxPaise: 1250,
  lines: [],
  createdAt: "2026-09-01T00:00:00.000Z",
};

const RECORDED = {
  ok: true,
  id: "pay-cafe-1",
  invoiceStatus: "paid",
  replayed: false,
};

const COMMITTED = {
  intentId: "intent-1",
  idempotencyKey: "key-1",
  committedAt: new Date().toISOString(),
  resultId: "pay-cafe-1",
  invoiceStatus: "paid" as const,
};

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

function payload(): {
  invoiceId?: string;
  amountPaise?: number;
  method?: string;
  reference?: string;
  idempotencyKey?: string;
} {
  return (recordPaymentAction.mock.calls[0]?.[0] ?? {}) as never;
}

async function waitForReady() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", {
        name: /record payment/i,
      }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}

describe("F01 — the café counter writer", () => {
  it("sends NO reference for a cash payment", async () => {
    recordPaymentAction.mockResolvedValue(RECORDED);
    const onPaid = vi.fn();
    render(<CafePaymentPanel bill={BILL} onPaid={onPaid} />);

    await waitForReady();
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await waitFor(() => expect(onPaid).toHaveBeenCalled());

    const sent = payload();
    expect(sent.invoiceId).toBe(BILL.invoiceId);
    expect(sent.amountPaise).toBe(BILL.amountDuePaise);
    expect(sent.method).toBe("cash");
    // Cash carries no reference: the key must be ABSENT, not empty (an
    // empty reference fails the action's schema).
    expect("reference" in sent).toBe(false);
    // …and the operation carries a key.
    expect(typeof sent.idempotencyKey).toBe("string");
  });

  it("sends the reference for a non-cash payment", async () => {
    recordPaymentAction.mockResolvedValue(RECORDED);
    const onPaid = vi.fn();
    render(<CafePaymentPanel bill={BILL} onPaid={onPaid} />);

    await waitForReady();
    fireEvent.click(screen.getByRole("button", { name: /upi/i }));
    fireEvent.change(screen.getByTestId("cafe-reference"), {
      target: { value: "UTR-4242" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await waitFor(() => expect(onPaid).toHaveBeenCalled());

    const sent = payload();
    expect(sent.method).toBe("upi");
    expect(sent.reference).toBe("UTR-4242");
    expect(typeof sent.idempotencyKey).toBe("string");
  });

  it("keeps the key when the same payment is retried", async () => {
    recordPaymentAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    const onPaid = vi.fn();
    render(<CafePaymentPanel bill={BILL} onPaid={onPaid} />);

    await waitForReady();
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByTestId("cafe-payment-error");

    recordPaymentAction.mockResolvedValue(RECORDED);
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await waitFor(() => expect(onPaid).toHaveBeenCalled());

    const keys = recordPaymentAction.mock.calls.map(
      (call) => (call[0] as { idempotencyKey?: unknown }).idempotencyKey,
    );
    expect(keys).toHaveLength(2);
    expect(typeof keys[0]).toBe("string");
    expect(keys[1]).toBe(keys[0]);
  });

  it("keeps the record and blocks when the key was consumed elsewhere", async () => {
    recordPaymentAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    let reads = 0;
    listPaymentRecoveryAction.mockImplementation(async () => {
      reads += 1;
      return reads <= 2
        ? { open: null, lastCommitted: null }
        : { open: null, lastCommitted: COMMITTED };
    });
    const onPaid = vi.fn();
    render(<CafePaymentPanel bill={BILL} onPaid={onPaid} />);

    await waitForReady();
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByTestId("cafe-payment-error");

    recordPaymentAction.mockResolvedValue({
      ok: false,
      error: "This submission was already recorded. Refresh before retrying.",
      conflict: "already_recorded",
    });
    await waitForReady();
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await waitFor(() => expect(recordPaymentAction).toHaveBeenCalledTimes(2));

    // The server read now returns the committed attempt: the target is
    // still blocked, and the explicit Retry/New choices stay available.
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/Your last recorded payment/i);
    expect(
      (screen.getByRole("button", {
        name: /choose a recovery option first/i,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
