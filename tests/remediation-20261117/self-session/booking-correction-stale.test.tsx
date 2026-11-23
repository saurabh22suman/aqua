// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BookingBill } from "@/lib/services/booking-billing";
const mocks = vi.hoisted(() => ({ get: vi.fn(), voidInvoice: vi.fn(), read: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/actions/invoices", () => ({ getInvoiceAction: mocks.get, voidInvoiceAction: mocks.voidInvoice }));
vi.mock("@/lib/actions/bookings", () => ({ readBookingBillAction: mocks.read, requestBookingBillAction: mocks.request }));
import { BookingInvoiceCorrection } from "@/components/bookings/booking-invoice-correction";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("reconciles a stale unpaid view against payment history without attempting reissue", async () => {
  mocks.voidInvoice.mockResolvedValue({ ok: false, error: "Payments are recorded" });
  mocks.get.mockResolvedValue({ status: "issued", paidPaise: 0, correctionEligibility: "payment_history" });
  mocks.read.mockResolvedValue({ ok: false });
  const bill = { bookingId: "b", invoiceId: "i", invoiceNumber: "INV", invoiceStatus: "issued", correctionEligibility: "eligible" } as BookingBill;
  render(<BookingInvoiceCorrection bill={bill} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct unpaid invoice" }));
  fireEvent.change(screen.getByLabelText("Corrected guest name"), { target: { value: "Updated Name" } });
  fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Typo" } });
  fireEvent.click(screen.getByRole("button", { name: "Void and reissue" }));
  expect(await screen.findByText(/payment history/i)).toBeTruthy();
  expect(mocks.request).not.toHaveBeenCalled();
});
