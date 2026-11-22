// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/components/cafe-payment-panel", () => ({ CafePaymentPanel: () => null }));
vi.mock("@/components/bookings/booking-entry-pass", () => ({ BookingEntryPass: () => null }));
vi.mock("@/components/bookings/booking-entry-actions.client", () => ({ mintBookingEntryPass: vi.fn() }));
vi.mock("@/components/bookings/booking-invoice-correction", () => ({ BookingInvoiceCorrection: () => null }));
import { InvoiceSummary } from "@/components/member-detail/invoice-summary";
import { CafeBillPanel } from "@/components/cafe-bill-panel";
import { BookingBillPanel } from "@/components/booking-bill-panel";
import type { InvoiceDetail } from "@/lib/services/invoices";
import type { CafeBill } from "@/lib/services/cafe-billing";
import type { BookingBill } from "@/lib/services/booking-billing";

const issuer = { legalName: "Frozen Issuer", legalAddress: { line1: "Issuer Road", line2: null, city: "Bengaluru", postalCode: "560001" }, stateCode: "29", gstin: "29ABCDE1234F1Z5" };
afterEach(cleanup);
it("shows the frozen issuer on invoice detail", () => {
  const detail: InvoiceDetail = { id: "invoice", financialYear: "2026-27", source: "cafe", locationId: "site", locationName: "Site", subscriptionId: null, activityName: null, createdAt: "2026-11-14T00:00:00Z", memberId: "member", memberName: "Member", payerKind: "member", payerName: "Member", issuer, gstin: issuer.gstin, invoiceNumber: "INV/2026-27/0001", documentKind: "tax_invoice", status: "issued", issuedOn: "2026-11-14", dueOn: "2026-11-14", lines: [], subtotalPaise: 10000, taxPaise: 0, totalPaise: 10000, paidPaise: 0, outstandingPaise: 10000 };
  render(<InvoiceSummary detail={detail} capturedTotalPaise={0} canReadPayments />);
  expect(screen.getByText(/Frozen Issuer/)).toBeTruthy();
});
it("shows the frozen issuer on café bills", () => {
  const bill: CafeBill = { orderId: "order", status: "billed", memberId: "member", locationId: "site", locationName: "Site", invoiceId: "invoice", invoiceStatus: "issued", issuer, memberName: "Member", documentKind: "tax_invoice", invoiceNumber: "INV/2026-27/0001", lines: [], subtotalPaise: 10000, taxPaise: 0, totalPaise: 10000, amountDuePaise: 10000 };
  render(<CafeBillPanel bill={bill} onPaid={() => {}} />);
  expect(screen.getByText(/Frozen Issuer/)).toBeTruthy();
});
it("shows the frozen issuer on booking bills", () => {
  const bill = { issuer, payerName: "Member", facilityName: "Court", documentKind: "tax_invoice", invoiceNumber: "INV/2026-27/0001", invoiceStatus: "issued", subtotalPaise: 10000, taxPaise: 0, totalPaise: 10000, amountDuePaise: 10000, startsAt: "2026-11-14T10:00:00Z", endsAt: "2026-11-14T11:00:00Z" } as BookingBill;
  render(<BookingBillPanel bill={bill} onPaid={() => {}} onBack={() => {}} />);
  expect(screen.getByText(/Frozen Issuer/)).toBeTruthy();
});
