// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const invoice = vi.fn();
const denied = vi.hoisted(() => ({value:false}));
vi.mock("next/navigation", () => ({notFound:() => {throw new Error("NOT_FOUND")}}));
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner:async () => ({permissions:new Set(["invoices.read"])}),requirePagePermission:() => {if (denied.value) throw new Error("NOT_FOUND")}}));
vi.mock("@/lib/auth/permission", () => ({hasPermission:() => false}));
vi.mock("@/lib/actions/invoices", () => ({getInvoiceAction:(id:string) => invoice(id)}));
vi.mock("@/components/fees/invoice-detail-surface", () => ({InvoiceDetailSurface:({invoiceId}:{invoiceId:string}) => <p>Scoped detail {invoiceId}</p>}));
import OwnerInvoicePage from "@/app/(owner)/owner/invoices/[invoiceId]/page";
afterEach(() => {cleanup(); vi.resetAllMocks(); denied.value = false;});
it("reads and displays only the invoice returned by the authorized lookup", async () => {
  invoice.mockResolvedValue({id:"i1",invoiceNumber:"INV-1",payerName:"Guest",locationName:"Site A"});
  render(await OwnerInvoicePage({params:Promise.resolve({invoiceId:"i1"})}));
  expect(invoice).toHaveBeenCalledWith("i1");
  expect(screen.getByText("Scoped detail i1")).toBeTruthy();
});
it("refuses missing and permission-denied invoices", async () => {
  invoice.mockResolvedValue(null);
  await expect(OwnerInvoicePage({params:Promise.resolve({invoiceId:"other"})})).rejects.toThrow("NOT_FOUND");
  denied.value = true;
  await expect(OwnerInvoicePage({params:Promise.resolve({invoiceId:"other"})})).rejects.toThrow("NOT_FOUND");
});
