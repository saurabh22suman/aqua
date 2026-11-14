// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({useRouter:() => ({refresh:vi.fn()})}));
vi.mock("@/lib/actions/fees-hub", () => ({listHubInvoicesAction:vi.fn()}));
vi.mock("@/components/member-detail/invoice-expanded", () => ({InvoiceExpanded:({invoiceId}:{invoiceId:string}) => <p>Invoice detail {invoiceId}</p>}));
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";
afterEach(cleanup);
it("opens only the invoice contained in the authorized ledger rows", () => {
  const row = {id:"i1",invoiceNumber:"INV-1",memberId:null,memberName:null,payerKind:"guest",payerName:"Guest",totalPaise:20000,paidPaise:10000,outstandingPaise:10000,status:"partial",source:"other",issuedOn:"2026-11-01",dueOn:"2026-11-15",locationName:"A"} satisfies HubInvoiceRow;
  render(<FeesInvoiceList initial={[row]} filter="all" canWrite={false} canRecord={false} canRefund={false} canReadPayments={false} {...{initialInvoiceId:"i1"}} />);
  expect(screen.getByText("Invoice detail i1")).toBeTruthy();
});
it("updates the expanded invoice when a new search result targets another authorized row", () => {
  const row = {id:"i1",invoiceNumber:"INV-1",memberId:null,memberName:null,payerKind:"guest",payerName:"Guest",totalPaise:20000,paidPaise:10000,outstandingPaise:10000,status:"partial",source:"other",issuedOn:"2026-11-01",dueOn:"2026-11-15",locationName:"A"} satisfies HubInvoiceRow;
  const other = {...row,id:"i2",invoiceNumber:"INV-2"};
  const props = {initial:[row,other],filter:"all" as const,canWrite:false,canRecord:false,canRefund:false,canReadPayments:false};
  const {rerender} = render(<FeesInvoiceList {...props} {...{initialInvoiceId:"i1"}} />);
  rerender(<FeesInvoiceList {...props} {...{initialInvoiceId:"i2"}} />);
  expect(screen.getByText("Invoice detail i2")).toBeTruthy();
  expect(screen.queryByText("Invoice detail i1")).toBeNull();
});
