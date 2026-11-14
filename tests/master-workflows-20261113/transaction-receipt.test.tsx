// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FeesTransactionList } from "@/components/fees/fees-transaction-list";
import type { HubTransactionRow } from "@/lib/services/fees-hub";
afterEach(cleanup);
it("links each payment to its own receipt without treating a reversal ID as a payment ID", () => {
  const base = { receivedAt:"2026-11-13T05:00:00Z", amountPaise:106250, method:"upi", reference:"UPI-1", invoiceNumber:"INV-1", memberId:"m", memberName:"Test", payerName:"Test", locationName:"Site A", receivedByName:null, reason:null } as const;
  const rows = [{ ...base, id:"p1", paymentId:"p1", kind:"payment" }, { ...base, id:"r1", paymentId:"p1", kind:"reversal", amountPaise:-106250, reason:"Correction" }] as HubTransactionRow[];
  render(<FeesTransactionList rows={rows} memberLabel="Member" canReadReceipts />);
  const rendered = screen.getAllByTestId("fees-transaction-row");
  expect(within(rendered[0]!).getByRole("link", {name:/view receipt/i}).getAttribute("href")).toBe("/api/receipts/p1");
  expect(within(rendered[1]!).getByRole("link", {name:/view original receipt/i}).getAttribute("href")).toBe("/api/receipts/p1");
});

it("does not offer a receipt action without invoice-read permission", () => {
  const row = { id:"p1", receivedAt:"2026-11-13T05:00:00Z", amountPaise:100, method:"cash", reference:null, invoiceNumber:"INV-1", memberId:null, memberName:null, payerName:"Guest", locationName:"Site A", receivedByName:null, kind:"payment", reason:null } satisfies HubTransactionRow;
  render(<FeesTransactionList rows={[row]} memberLabel="Member" />);
  expect(screen.queryByRole("link", {name:/receipt/i})).toBeNull();
});
it("links an authorized cash receipt to the exact guest payment", () => {
  const row = { id:"cash-p1", paymentId:"cash-p1", receivedAt:"2026-11-13T05:00:00Z", amountPaise:100, method:"cash", reference:null, invoiceNumber:"INV-1", memberId:null, memberName:null, payerName:"Guest", locationName:"Site A", receivedByName:null, kind:"payment", reason:null } satisfies HubTransactionRow;
  render(<FeesTransactionList rows={[row]} memberLabel="Member" canReadReceipts />);
  expect(screen.getByRole("link",{name:/view receipt/i}).getAttribute("href")).toBe("/api/receipts/cash-p1");
});
