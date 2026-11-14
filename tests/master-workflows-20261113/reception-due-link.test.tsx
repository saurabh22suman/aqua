// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/surface-guard", () => ({requireReception:async () => ({permissions:new Set(["payments.record"])})}));
vi.mock("@/lib/auth/permission", () => ({hasPermission:(ctx:{permissions:Set<string>}, key:string) => ctx.permissions.has(key),hasFeature:() => true}));
vi.mock("@/lib/actions/fees-hub", () => ({listDeskDuesAction:async () => [{id:"inv-1",invoiceNumber:"INV-1",payerName:"Guest",memberCode:null,phone:null,dueOn:"2026-11-10",outstandingPaise:5000,overdue:true},{id:"inv-2",invoiceNumber:"INV-2",payerName:"Guest",memberCode:null,phone:null,dueOn:"2026-11-11",outstandingPaise:7000,overdue:true}]}));
import ReceptionDuesPage from "@/app/(reception)/reception/dues/page";
afterEach(cleanup);
it("offers a no-phone walk-in a contextual route carrying only invoice identity", async () => {
  render(await ReceptionDuesPage());
  const links = screen.getAllByRole("link",{name:/collect.*guest/i}).map(link => link.getAttribute("href"));
  expect(links).toEqual(["/reception/collect-payment?invoice=inv-1","/reception/collect-payment?invoice=inv-2"]);
  expect(document.body.textContent).toContain("INV-1");
  expect(document.body.textContent).toContain("INV-2");
});
