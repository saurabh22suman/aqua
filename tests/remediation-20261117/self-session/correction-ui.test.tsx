// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BookingBill } from "@/lib/services/booking-billing";

const mocks = vi.hoisted(() => ({ invoice: vi.fn() }));
vi.mock("@/lib/actions/invoices", () => ({ getInvoiceAction: mocks.invoice, voidInvoiceAction: vi.fn() }));
vi.mock("@/lib/actions/payments", () => ({ listInvoicePaymentsAction: vi.fn(async () => []), recordPaymentAction: vi.fn() }));
vi.mock("@/lib/actions/payment-reversals", () => ({ listPaymentReversalsAction: vi.fn(async () => []) }));
vi.mock("@/components/member-detail/invoice-summary", () => ({ InvoiceSummary: () => <p>Invoice details</p> }));
vi.mock("@/components/member-detail/invoice-payment-list", () => ({ InvoicePaymentList: () => null }));
vi.mock("@/components/member-detail/invoice-payment-form", () => ({ InvoicePaymentForm: () => null }));
vi.mock("@/components/member-detail/invoice-closed-recovery", () => ({ InvoiceClosedRecovery: () => null }));
vi.mock("@/components/cafe-payment-panel", () => ({ CafePaymentPanel: () => null }));
vi.mock("@/components/bookings/booking-entry-pass", () => ({ BookingEntryPass: () => null }));
vi.mock("@/components/bookings/booking-entry-actions.client", () => ({ mintBookingEntryPass: vi.fn() }));
vi.mock("@/components/bookings/booking-invoice-correction", () => ({ BookingInvoiceCorrection: () => <button>Correct invoice</button> }));
import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";
import { BookingBillPanel } from "@/components/booking-bill-panel";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
it.each(["cafe", "payment_history", "unavailable"])("does not offer invoice void for %s", async reason => {
  mocks.invoice.mockResolvedValue({ id: "i", invoiceNumber: "INV", status: "issued", paidPaise: 0, outstandingPaise: 100, lines: [], correctionEligibility: reason });
  render(<InvoiceExpanded invoiceId="i" canWrite canVoid canRecord={false} canRefund={false} canReadPayments={false} onChanged={() => {}} />);
  await screen.findByText("Invoice details");
  expect(screen.queryByRole("button", { name: "Void invoice" })).toBeNull();
});
it("offers invoice void for an eligible unpaid invoice", async () => {
  mocks.invoice.mockResolvedValue({ id: "i", invoiceNumber: "INV", status: "issued", paidPaise: 0, outstandingPaise: 100, lines: [], correctionEligibility: "eligible" });
  render(<InvoiceExpanded invoiceId="i" canWrite canVoid canRecord={false} canRefund={false} canReadPayments={false} onChanged={() => {}} />);
  expect(await screen.findByRole("button", { name: "Void invoice" })).toBeTruthy();
});
it.each(["payment_history", "cafe", "unavailable"])("does not offer booking correction for %s", reason => {
  const bill = { bookingId: "b", invoiceId: "i", invoiceNumber: "INV", invoiceStatus: "issued", memberId: null, payerName: "Guest", facilityName: "Court", startsAt: "2026-11-14T10:00:00Z", endsAt: "2026-11-14T11:00:00Z", totalPaise: 100, amountDuePaise: 100, subtotalPaise: 100, taxPaise: 0, correctionEligibility: reason } as BookingBill;
  render(<BookingBillPanel bill={bill} canCorrectInvoice onPaid={() => {}} onBack={() => {}} />);
  expect(screen.queryByRole("button", { name: "Correct invoice" })).toBeNull();
});
it("offers booking correction only when eligible and authorized", () => {
  const bill = { bookingId: "b", invoiceId: "i", invoiceNumber: "INV", invoiceStatus: "void", memberId: null, payerName: "Guest", facilityName: "Court", startsAt: "2026-11-14T10:00:00Z", endsAt: "2026-11-14T11:00:00Z", totalPaise: 100, amountDuePaise: 0, subtotalPaise: 100, taxPaise: 0, correctionEligibility: "eligible" } as BookingBill;
  const view = render(<BookingBillPanel bill={bill} canCorrectInvoice onPaid={() => {}} onBack={() => {}} />);
  expect(screen.getByRole("button", { name: "Correct invoice" })).toBeTruthy();
  view.rerender(<BookingBillPanel bill={{ ...bill, correctionEligibility: "payment_history" }} canCorrectInvoice onPaid={() => {}} onBack={() => {}} />);
  expect(screen.queryByRole("button", { name: "Correct invoice" })).toBeNull();
  view.rerender(<BookingBillPanel bill={bill} onPaid={() => {}} onBack={() => {}} />);
  expect(screen.queryByRole("button", { name: "Correct invoice" })).toBeNull();
});
