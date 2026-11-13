// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const lookup = vi.fn();
vi.mock("@/lib/actions/fees-hub", () => ({listHubInvoicesAction: (...args: unknown[]) => lookup(...args)}));
vi.mock("next/navigation", () => ({useRouter: () => ({refresh: vi.fn()})}));
vi.mock("@/components/member-detail/invoice-expanded", () => ({InvoiceExpanded: () => null}));
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
afterEach(() => {cleanup(); vi.resetAllMocks();});
it("looks up a known invoice on the server inside the selected facility, not only the initial list", async () => {
  lookup.mockResolvedValue([]);
  render(<FeesInvoiceList initial={[]} filter="dues" facility="facility-a" canWrite={false} canRecord={false} canRefund={false} canReadPayments={false} />);
  fireEvent.change(screen.getByLabelText(/search.*invoice/i), {target:{value:"INV-100"}});
  fireEvent.click(screen.getByRole("button", {name:/search/i}));
  await waitFor(() => expect(lookup).toHaveBeenCalledWith(expect.objectContaining({status:"dues",locationId:"facility-a",search:"INV-100"})));
  expect(screen.getByText(/no .*match/i)).toBeTruthy();
});
it("restores a search on returning to the same tenant, user and facility history entry", async () => {
  lookup.mockResolvedValue([]);
  const props = {initial:[],filter:"dues" as const,facility:"facility-a",canWrite:false,canRecord:false,canRefund:false,canReadPayments:false,navigationNamespace:"tenant-a:user-a"};
  const first = render(<FeesInvoiceList {...props} />);
  fireEvent.change(screen.getByLabelText(/search.*invoice/i),{target:{value:"INV-100"}});
  fireEvent.click(screen.getByRole("button",{name:/search/i}));
  await waitFor(() => expect(lookup).toHaveBeenCalled());
  first.unmount();
  render(<FeesInvoiceList {...props} />);
  await waitFor(() => expect((screen.getByLabelText(/search.*invoice/i) as HTMLInputElement).value).toBe("INV-100"));
  expect(window.location.href).not.toContain("INV-100");
});
it("does not restore a prior user's in-memory search into another account", async () => {
  lookup.mockResolvedValue([]);
  const props = {initial:[],filter:"dues" as const,facility:"facility-a",canWrite:false,canRecord:false,canRefund:false,canReadPayments:false};
  const first = render(<FeesInvoiceList {...props} navigationNamespace="tenant-a:user-a" />);
  fireEvent.change(screen.getByLabelText(/search.*invoice/i),{target:{value:"private query"}});
  fireEvent.click(screen.getByRole("button",{name:/search/i}));
  await waitFor(() => expect(lookup).toHaveBeenCalled());
  first.unmount();
  lookup.mockClear();
  render(<FeesInvoiceList {...props} navigationNamespace="tenant-b:user-b" />);
  expect((screen.getByLabelText(/search.*invoice/i) as HTMLInputElement).value).toBe("");
  expect(lookup).not.toHaveBeenCalled();
});
