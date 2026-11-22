// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { InvoiceReversalForm } from "@/components/member-detail/invoice-reversal-form";
import type { PaymentRow } from "@/lib/services/payments";

const mocks = vi.hoisted(() => ({
  recover: vi.fn(),
  reverse: vi.fn(),
  mint: vi.fn(),
}));
vi.mock("@/lib/actions/payment-intents", () => ({
  listReversalRecoveryAction: mocks.recover,
  cancelReversalRecoveryAction: vi.fn(),
}));
vi.mock("@/lib/actions/payment-reversals", () => ({ reversePaymentAction: mocks.reverse }));
vi.mock("@/lib/payment-key", () => ({ mintPaymentKey: mocks.mint }));

const earlier = {
  intentId: "earlier",
  idempotencyKey: "earlier-key",
  resultId: "a",
  committedAt: "2026-11-20T08:00:00Z",
};
const latest = {
  intentId: "latest",
  idempotencyKey: "attempt-1",
  resultId: "b",
  committedAt: "2026-11-21T08:00:00Z",
};

function TestForm() {
  const [busy, setBusy] = useState(false);
  return <InvoiceReversalForm
    payment={{ id: "payment" } as PaymentRow}
    remainingPaise={40_000}
    busy={busy}
    setBusy={setBusy}
    onReload={async () => "ok"}
    onChanged={() => {}}
    onMessage={() => {}}
    onClose={() => {}}
  />;
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function sendReversalWithLostResponse(committed: typeof earlier) {
  mocks.recover.mockResolvedValue({ open: null, lastCommitted: earlier });
  mocks.reverse.mockImplementationOnce(async () => {
    mocks.recover.mockResolvedValue({ open: null, lastCommitted: committed });
    throw new Error("Response lost");
  }).mockResolvedValueOnce({ ok: true });
  mocks.mint.mockReturnValueOnce("attempt-1").mockReturnValueOnce("attempt-2");

  render(<TestForm />);
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Test correction" } });
  const separate = { name: "Record a separate reversal" };
  fireEvent.click(await screen.findByRole("button", separate));
  fireEvent.click(screen.getByRole("button", { name: "Confirm new operation" }));
  const confirm = screen.getAllByRole("button", separate).at(-1)!;
  fireEvent.click(confirm);
  await waitFor(() => expect(mocks.recover).toHaveBeenCalledTimes(2));
  expect(mocks.reverse).toHaveBeenNthCalledWith(1, expect.objectContaining({
    idempotencyKey: "attempt-1", observedIntentId: "earlier", amountPaise: 10_000,
  }));
}

it("requires a new confirmation if a lost response is followed by a newly recorded reversal", async () => {
  await sendReversalWithLostResponse(latest);

  const confirm = await screen.findByRole<HTMLButtonElement>("button", { name: "Choose above, then confirm" });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(mocks.reverse).toHaveBeenCalledTimes(1);

  const retry = { name: "Retry the same reversal" };
  fireEvent.click(screen.getByRole("button", retry));
  fireEvent.click(screen.getAllByRole("button", retry).at(-1)!);
  expect(mocks.reverse).toHaveBeenNthCalledWith(2, expect.objectContaining({
    idempotencyKey: "attempt-1", observedIntentId: "latest", amountPaise: 10_000,
  }));
  expect(mocks.mint).toHaveBeenCalledTimes(1);
});

it("reuses the key when a lost response leaves the earlier reversal as the current observation", async () => {
  await sendReversalWithLostResponse(earlier);

  const separate = { name: "Record a separate reversal" };
  await waitFor(() => expect(screen.getAllByRole<HTMLButtonElement>("button", separate).at(-1)?.disabled).toBe(false));
  fireEvent.click(screen.getAllByRole("button", separate)[0]);
  fireEvent.click(screen.getByRole("button", { name: "Confirm new operation" }));
  fireEvent.click(screen.getAllByRole("button", separate).at(-1)!);
  expect(mocks.reverse).toHaveBeenNthCalledWith(2, expect.objectContaining({
    idempotencyKey: "attempt-1", observedIntentId: "earlier", amountPaise: 10_000,
  }));
  expect(mocks.mint).toHaveBeenCalledTimes(1);
});

it("uses a fresh key when the user explicitly confirms a separate reversal after the latest save", async () => {
  await sendReversalWithLostResponse(latest);

  await screen.findByRole("button", { name: "Choose above, then confirm" });
  const separate = { name: "Record a separate reversal" };
  fireEvent.click(screen.getByRole("button", separate));
  fireEvent.click(screen.getByRole("button", { name: "Confirm new operation" }));
  fireEvent.click(screen.getAllByRole("button", separate).at(-1)!);
  expect(mocks.reverse).toHaveBeenNthCalledWith(2, expect.objectContaining({
    idempotencyKey: "attempt-2", observedIntentId: "latest", amountPaise: 10_000,
  }));
});
