// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PaymentIntentRecovery } from "@/lib/services/payment-intent-recovery";
const api = vi.hoisted(() => ({ list: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/actions/payment-intents", () => ({ listPaymentRecoveryAction: api.list, cancelPaymentRecoveryAction: api.cancel }));
import { InvoiceClosedRecovery } from "@/components/member-detail/invoice-closed-recovery";
const open = (intentId: string): PaymentIntentRecovery => ({ open: { intentId, idempotencyKey: "key", createdAt: "2026-10-29T10:00:00Z" }, lastCommitted: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("retains a confirmation requested at the first recovery insertion", async () => {
  const load = deferred<PaymentIntentRecovery>(); api.list.mockReturnValue(load.promise);
  const { container } = render(<InvoiceClosedRecovery invoiceId="a" canRecord onReload={async () => "ok"} onMessage={() => {}} />);
  let clicked = false;
  const observer = new MutationObserver(() => {
    const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Discard earlier attempt");
    if (button && !clicked) { clicked = true; fireEvent.click(button); }
  });
  observer.observe(container, { childList: true, subtree: true });
  await act(async () => { load.resolve(open("intent-a")); });
  await waitFor(() => expect(clicked).toBe(true));
  expect(screen.getByRole("button", { name: "Confirm discard" })).toBeTruthy();
  observer.disconnect();
});
it("invalidates confirmation when invoice and intent change", async () => {
  api.list.mockImplementation(async ({ targetId }: { targetId: string }) => open(`intent-${targetId}`));
  const props = { canRecord: true, onReload: async () => "ok" as const, onMessage: () => {} };
  const { rerender } = render(<InvoiceClosedRecovery invoiceId="a" {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Discard earlier attempt" }));
  expect(screen.getByRole("button", { name: "Confirm discard" })).toBeTruthy();
  rerender(<InvoiceClosedRecovery invoiceId="b" {...props} />);
  expect(await screen.findByRole("button", { name: "Discard earlier attempt" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Confirm discard" })).toBeNull();
  expect(api.cancel).not.toHaveBeenCalled();
});
it("does not expose or discard an attempt without record permission", async () => {
  api.list.mockResolvedValue(open("intent-a"));
  render(<InvoiceClosedRecovery invoiceId="a" canRecord={false} onReload={async () => "ok"} onMessage={() => {}} />);
  await waitFor(() => expect(api.list).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();
  expect(api.cancel).not.toHaveBeenCalled();
});
it("rechecks a refused discard and retains the refusal result", async () => {
  api.list.mockResolvedValueOnce(open("intent-a")).mockResolvedValue({ open: null, lastCommitted: null });
  api.cancel.mockResolvedValue({ ok: false, error: "Attempt not found." });
  const reload = vi.fn(async () => "ok" as const);
  render(<InvoiceClosedRecovery invoiceId="a" canRecord onReload={reload} onMessage={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Discard earlier attempt" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm discard" }));
  expect(await screen.findByTestId("closed-intent-result")).toBeTruthy();
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith({ intentId: "intent-a" });
  expect(api.list).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});
it("allows a fresh confirmation after a recheck returns the same intent", async () => {
  api.list.mockImplementation(async () => open("intent-a"));
  api.cancel.mockResolvedValue({ ok: false, error: "Attempt not found." });
  render(<InvoiceClosedRecovery invoiceId="a" canRecord onReload={async () => "ok"} onMessage={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Discard earlier attempt" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm discard" }));
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Attempt not found.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Discard earlier attempt" }));
  expect(screen.getByRole("button", { name: "Confirm discard" })).toBeTruthy();
  expect(api.cancel).toHaveBeenCalledTimes(1);
});
it("requires a new confirmation when recheck returns a different intent", async () => {
  api.list.mockResolvedValueOnce(open("intent-a")).mockResolvedValue(open("intent-b"));
  api.cancel.mockResolvedValue({ ok: false, error: "Attempt not found." });
  render(<InvoiceClosedRecovery invoiceId="a" canRecord onReload={async () => "ok"} onMessage={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Discard earlier attempt" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm discard" }));
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Attempt not found.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Confirm discard" })).toBeNull();
  expect(screen.getByRole("button", { name: "Discard earlier attempt" })).toBeTruthy();
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith({ intentId: "intent-a" });
});
