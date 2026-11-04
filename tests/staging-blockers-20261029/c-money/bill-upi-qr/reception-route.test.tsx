// @vitest-environment jsdom
//
// Composed reception route proof: the bill journey must have ONE
// amount source and ONE bill-linked QR. The old standalone CollectPayment
// amount/QR block must not sit above the payment form.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.stubGlobal("crypto", { randomUUID });

vi.mock("@/lib/auth/surface-guard", () => ({
  requireReception: async () => ({
    permissions: new Set(["payments.record", "invoices.read", "settings.read"]),
    features: new Set(["billing"]),
  }),
}));

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
const listInvoicePaymentsAction = vi.fn();
vi.mock("@/lib/actions/payments", () => ({
  recordPaymentAction: (...args: unknown[]) => recordPaymentAction(...args),
  listInvoicePaymentsAction: (...args: unknown[]) =>
    listInvoicePaymentsAction(...args),
}));

const listPaymentRecoveryAction = vi.fn();
const cancelPaymentRecoveryAction = vi.fn();
vi.mock("@/lib/actions/payment-intents", () => ({
  listPaymentRecoveryAction: (...args: unknown[]) =>
    listPaymentRecoveryAction(...args),
  cancelPaymentRecoveryAction: (...args: unknown[]) =>
    cancelPaymentRecoveryAction(...args),
}));

const listPaymentQrsAction = vi.fn();
vi.mock("@/lib/actions/payment-qrs", () => ({
  listPaymentQrsAction: (...args: unknown[]) => listPaymentQrsAction(...args),
}));

const toStringMock = vi.fn();
vi.mock("qrcode", () => ({
  toString: (...args: unknown[]) => toStringMock(...args),
}));

import CollectPaymentPage from "@/app/(reception)/reception/collect-payment/page";
import type { PaymentQrRow } from "@/lib/services/payment-qrs";

const MEMBER = {
  memberId: "member-1",
  fullName: "Audit Child",
  memberCode: "MEM-0001",
  phone: "+919900000001",
};

const INVOICE = {
  id: "inv-1",
  invoiceNumber: "INV/2026-27/0001",
  financialYear: "2026-27",
  documentKind: "bill_of_supply" as const,
  issuedOn: "2026-09-01",
  dueOn: "2026-09-10",
  subtotalPaise: 250000,
  taxPaise: 0,
  totalPaise: 250000,
  paidPaise: 100000,
  outstandingPaise: 150000,
  status: "partial" as const,
  source: "membership" as const,
  gstin: null,
  locationId: "loc-1",
  locationName: "Main",
  subscriptionId: "sub-1",
  activityName: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

const UPI_QR: PaymentQrRow = {
  id: "qr-upi-1",
  nickname: "Counter UPI",
  kind: "upi",
  upiId: "club@okhdfcbank",
  payeeName: "Sharma Sports",
  imageMime: null,
  hasImage: false,
  isActive: true,
  sortOrder: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
};

beforeEach(() => {
  listMembersAction.mockResolvedValue([MEMBER]);
  listMemberInvoicesAction.mockResolvedValue([INVOICE]);
  listInvoicePaymentsAction.mockResolvedValue([]);
  listPaymentRecoveryAction.mockResolvedValue({
    open: null,
    lastCommitted: null,
  });
  cancelPaymentRecoveryAction.mockResolvedValue({
    ok: true,
    intentId: "intent-1",
    replayed: false,
  });
  listPaymentQrsAction.mockResolvedValue([UPI_QR]);
  recordPaymentAction.mockResolvedValue({
    ok: true,
    id: "pay-1",
    invoiceStatus: "paid",
    replayed: false,
  });
  toStringMock.mockResolvedValue('<svg data-testid="route-qr-svg"></svg>');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function pickInvoice() {
  fireEvent.change(screen.getByLabelText(/find member/i), {
    target: { value: "Audit" },
  });
  fireEvent.click(screen.getByRole("button", { name: /search/i }));
  fireEvent.click(await screen.findByTestId("payment-member-member-1"));
  await screen.findByTestId("payment-invoice-inv-1");
  fireEvent.click(screen.getByTestId("payment-invoice-inv-1"));
}

describe("reception collect-payment route composition", () => {
  it("renders one bill-journey amount and no standalone QR amount", async () => {
    render(await CollectPaymentPage());
    await pickInvoice();

    expect(await screen.findByTestId("payment-amount")).toBeTruthy();
    expect(screen.queryByTestId("collect-amount")).toBeNull();
    expect(screen.queryByTestId("collect-qr")).toBeNull();
    expect(screen.queryByTestId("collect-qr-select")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /upi/i }));
    fireEvent.click(await screen.findByRole("button", { name: /show upi qr/i }));
    await waitFor(() => expect(toStringMock).toHaveBeenCalled());
    expect(toStringMock.mock.calls.at(-1)?.[0]).toContain("am=1500.00");
    expect(recordPaymentAction).not.toHaveBeenCalled();
  });
});
