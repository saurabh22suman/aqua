// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const getInvoice = vi.fn();
const grants = vi.hoisted(() => ({value:new Set(["invoices.read","payments.record"])}));
vi.mock("@/lib/auth/surface-guard", () => ({requireReception:async () => ({permissions:grants.value})}));
vi.mock("@/lib/auth/permission", () => ({hasPermission:(ctx: {permissions:Set<string>}, key:string) => ctx.permissions.has(key),hasFeature:() => true}));
vi.mock("@/lib/actions/invoices", () => ({getInvoiceAction:(id:string) => getInvoice(id),listMemberInvoicesAction:vi.fn()}));
vi.mock("@/lib/actions/people", () => ({listMembersAction:vi.fn()}));
vi.mock("@/components/reception/payment-record-recovery-form", () => ({PaymentRecordRecoveryForm:({invoice}:{invoice:{id:string}}) => <p>Selected invoice {invoice.id}</p>}));
import CollectPaymentPage from "@/app/(reception)/reception/collect-payment/page";
afterEach(() => {cleanup(); vi.resetAllMocks(); grants.value = new Set(["invoices.read","payments.record"]);});
it("loads the exact invoice using the authorized server lookup before offering collection", async () => {
  getInvoice.mockResolvedValue({id:"inv-1",invoiceNumber:"INV-1",payerName:"Guest",outstandingPaise:5000,status:"partial"});
  render(await CollectPaymentPage({searchParams:Promise.resolve({invoice:"inv-1"})}));
  expect(getInvoice).toHaveBeenCalledWith("inv-1");
  expect(screen.getByText("Selected invoice inv-1")).toBeTruthy();
});
it("does not look up an invoice for a role without payment permission", async () => {
  grants.value = new Set(["invoices.read"]);
  render(await CollectPaymentPage({searchParams:Promise.resolve({invoice:"inv-1"})}));
  expect(getInvoice).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("not available");
});
it("does not offer payment for an invoice that has become settled", async () => {
  getInvoice.mockResolvedValue({id:"inv-1",invoiceNumber:"INV-1",payerName:"Guest",outstandingPaise:0,status:"paid"});
  render(await CollectPaymentPage({searchParams:Promise.resolve({invoice:"inv-1"})}));
  expect(screen.queryByText("Selected invoice inv-1")).toBeNull();
  expect(screen.getByText(/not currently available for collection/i)).toBeTruthy();
});
