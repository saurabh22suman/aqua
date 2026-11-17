// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  cookie: "11111111-1111-4111-8111-111111111111",
  allowed: true,
  invoices: vi.fn(async () => []),
  overview: vi.fn(async () => ({collectedPaise:12300,paymentCount:1,reversedPaise:0,reversalCount:0,outstandingPaise:100,dueInvoiceCount:1,overduePaise:0,overdueInvoiceCount:0,today:"2026-11-16",overdueAgeing:[]})),
}));
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner:async()=>({permissions:new Set(["reports.financial"])}),requirePagePermission:vi.fn()}));
vi.mock("@/lib/auth/owner-settings-page-guard",()=>({isLiveOwnerForSettings:async()=>false}));
vi.mock("@/lib/services/selected-facility-access",()=>({canSelectFacility:async()=>state.allowed}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>({value:state.cookie})})}));
vi.mock("@/lib/actions/tenant-timezone",()=>({getTenantTimezoneAction:async()=>"Asia/Kolkata"}));
vi.mock("@/db/tenant",()=>({withTenant:async()=>[{timezone:"Asia/Kolkata"}]}));
vi.mock("@/lib/actions/terminology",()=>({getTerminologyAction:async()=>({overrides:{},locale:"en"})}));
vi.mock("@/lib/actions/membership-plans",()=>({listPlansAction:async()=>[]}));
vi.mock("@/lib/actions/fees-hub",()=>({getFeesOverviewAction:state.overview,listHubInvoicesAction:state.invoices,listHubTransactionsAction:async()=>({rows:[],totalCount:0,truncated:false,limit:200})}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
import FeesPage from "@/app/(owner)/owner/fees/page";
afterEach(()=>{cleanup();state.overview.mockClear();state.invoices.mockClear();state.allowed=true;});

it("keeps the all sentinel out of dues search and clear requests",async()=>{
  const tab="dues";
  render(await FeesPage({searchParams:Promise.resolve({tab,facility:"all"})}));
  state.invoices.mockClear();
  fireEvent.change(screen.getByRole("searchbox",{name:"Search member, phone or invoice"}),{target:{value:"LOCAL"}});
  fireEvent.click(screen.getByRole("button",{name:"Search"}));
  await waitFor(()=>expect(state.invoices).toHaveBeenCalledWith({status:tab==="dues"?"dues":"all",search:"LOCAL"}));
  state.invoices.mockClear();
  fireEvent.click(screen.getByRole("button",{name:"Clear"}));
  await waitFor(()=>expect(state.invoices).toHaveBeenCalledWith({status:tab==="dues"?"dues":"all"}));
});

it("retains explicit all-facilities scope on every period tab and balance drill-down",async()=>{
  render(await FeesPage({searchParams:Promise.resolve({facility:"all",from:"2026-10-01",to:"2026-11-01"})}));
  const links = screen.getAllByRole("link").filter(link=>link.getAttribute("href")?.startsWith("/owner/fees?"));
  expect(links.length).toBeGreaterThan(5);
  for (const link of links) expect(new URL(link.getAttribute("href")!,"http://localhost").searchParams.get("facility")).toBe("all");
  expect(state.overview).toHaveBeenCalledWith({from:"2026-10-01",to:"2026-11-01"});
});

it.each(["not-a-uuid", ""])("refuses malformed explicit scope %s without silently using the cookie",async(facility)=>{
  render(await FeesPage({searchParams:Promise.resolve({facility})}));
  expect(screen.getByRole("heading",{name:"Club unavailable"})).toBeTruthy();
  expect(state.overview).not.toHaveBeenCalled();
});

it("refuses an inaccessible facility and offers a safe recovery scope",async()=>{
  state.allowed=false;
  render(await FeesPage({searchParams:Promise.resolve({facility:state.cookie,from:"2026-10-01",to:"2026-11-01"})}));
  const recovery = new URL(screen.getByRole("link",{name:"View available clubs"}).getAttribute("href")!,"http://localhost");
  expect(recovery.searchParams.get("facility")).toBe("all");
  expect(recovery.searchParams.get("from")).toBe("2026-10-01");
  expect(state.overview).not.toHaveBeenCalled();
});
