// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/invoices", () => ({getInvoiceAction:vi.fn()}));
vi.mock("@/components/reception/payment-record-recovery-form", () => ({PaymentRecordRecoveryForm:({onReceipt}:{onReceipt?:(id:string) => void}) => <button onClick={() => onReceipt?.("pay-1")}>Confirm synthetic payment</button>}));
import { PreselectedInvoice } from "@/components/reception/preselected-invoice";
import type { InvoiceDetail } from "@/lib/services/invoices";
afterEach(cleanup);
it("keeps the confirmed payment's exact receipt available after collection", () => {
  const invoice = {id:"i1",invoiceNumber:"INV-1",payerName:"Guest",locationName:"Site A",outstandingPaise:10000,status:"partial"} as InvoiceDetail;
  render(<PreselectedInvoice initial={invoice} />);
  fireEvent.click(screen.getByRole("button",{name:/confirm synthetic payment/i}));
  expect(screen.getByRole("link",{name:/view receipt/i}).getAttribute("href")).toBe("/api/receipts/pay-1");
});
