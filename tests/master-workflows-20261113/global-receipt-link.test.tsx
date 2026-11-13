// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/global-search", () => ({globalSearchAction:vi.fn()}));
import { GlobalSearch } from "@/components/global-search";
afterEach(cleanup);
it("opens a receipt as a deliberate document request rather than prefetching it as a page", async () => {
  render(<GlobalSearch searchAction={async () => [{kind:"payment",id:"p",title:"Payment UTR",subtitle:"Received ₹1",href:"/api/receipts/p"}]} />);
  const input = screen.getByTestId("global-search-input");
  fireEvent.change(input,{target:{value:"UTR"}});
  fireEvent.submit(input.closest("form")!);
  const link = await screen.findByRole("link",{name:/Payment UTR/i});
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noreferrer");
});
it("labels financial search results without calling every invoice a payment", async () => {
  render(<GlobalSearch searchAction={async () => [{kind:"payment",id:"i",title:"Invoice INV-1",subtitle:"Invoice total ₹2",href:"/owner/invoices/i"}]} />);
  const input = screen.getByTestId("global-search-input");
  fireEvent.change(input,{target:{value:"INV"}});
  fireEvent.submit(input.closest("form")!);
  expect(await screen.findByText("Invoices & payments")).toBeTruthy();
});
