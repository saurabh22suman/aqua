// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PaymentRecordForm } from "@/components/payment-record-form";
import type { InvoiceRow } from "@/lib/services/invoices";
import type { ComponentProps } from "react";
import type { PaymentRecordRecoveryForm } from "@/components/reception/payment-record-recovery-form";

const mocks = vi.hoisted(() => ({ members: vi.fn(), invoices: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ listMembersAction: mocks.members }));
vi.mock("@/lib/actions/invoices", () => ({ listMemberInvoicesAction: mocks.invoices }));
vi.mock("@/components/reception/payment-record-recovery-form", () => ({
  PaymentRecordRecoveryForm: ({ invoice, onRecorded, onBusyChange, onMessage, onReceipt }: ComponentProps<typeof PaymentRecordRecoveryForm>) => (
    <>
      <p>Recording controls</p>
      <input aria-label="Recordable balance" readOnly value={invoice.outstandingPaise} />
      <button type="button">Show bill QR</button>
      <button type="button" onClick={async () => {
        onBusyChange?.(true);
        onReceipt?.("payment-1");
        onMessage?.("Payment recorded.");
        await onRecorded();
        onBusyChange?.(false);
      }}>Record test payment</button>
    </>
  ),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

const invoice = { id: "inv-1", invoiceNumber: "INV-1", status: "issued", outstandingPaise: 10000, dueOn: "2026-11-14" } as InvoiceRow;

async function choosePayer() {
  mocks.members.mockResolvedValue([{ memberId: "m1", fullName: "Mira Patel", memberCode: "A1", locationName: "Worli" }]);
  render(<PaymentRecordForm />);
  const input = screen.getByTestId("payment-member-search");
  fireEvent.change(input, { target: { value: "A1" } });
  fireEvent.submit(input.closest("form")!);
  const member = await screen.findByTestId("payment-member-m1");
  member.focus();
  fireEvent.click(member);
}

it("retries a failed invoice read for the same member and keeps keyboard focus", async () => {
  mocks.invoices.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([invoice]);
  await choosePayer();
  expect((await screen.findByRole("alert")).textContent).toContain("Could not load invoices");
  const heading = screen.getByRole("heading", { name: "Invoices for Mira Patel" });
  expect(document.activeElement).toBe(heading);
  expect(screen.queryByText("Loading invoices…")).toBeNull();
  expect(screen.queryByText("Recording controls")).toBeNull();
  const retry = screen.getByRole("button", { name: "Retry invoice lookup" });
  retry.focus();
  fireEvent.click(retry);
  expect(await screen.findByText("Recording controls")).toBeTruthy();
  expect(document.activeElement).toBe(heading);
  expect(mocks.members).toHaveBeenCalledTimes(1);
  expect(mocks.invoices.mock.calls).toEqual([["m1"], ["m1"]]);
});

it.each([
  ["paid", { ...invoice, status: "paid", outstandingPaise: 0 }],
  ["held", { ...invoice, collectionHold: "booking_cancelled" }],
  ["partial", { ...invoice, status: "partial", outstandingPaise: 2500 }],
] as const)("keeps a confirmed outcome and blocks stale controls while refreshing to a %s invoice", async (result, refreshed) => {
  let resolveRetry!: (rows: InvoiceRow[]) => void;
  const retryRead = new Promise<InvoiceRow[]>((resolve) => { resolveRetry = resolve; });
  mocks.invoices.mockResolvedValueOnce([invoice]).mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(retryRead);
  await choosePayer();
  fireEvent.click(await screen.findByRole("button", { name: "Record test payment" }));
  const retry = await screen.findByRole("button", { name: "Retry invoice lookup" });
  fireEvent.click(retry);
  expect(screen.getByRole("heading", { name: "Invoices for Mira Patel" })).toBeTruthy();
  expect(screen.getByText("Payment recorded.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "View receipt" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Record test payment" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show bill QR" })).toBeNull();
  expect(screen.getByText("Loading invoices…")).toBeTruthy();
  await act(async () => resolveRetry([refreshed]));
  if (result === "partial") {
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Recordable balance" }).value).toBe("2500");
  } else {
    expect(screen.queryByRole("button", { name: "Record test payment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show bill QR" })).toBeNull();
  }
});
