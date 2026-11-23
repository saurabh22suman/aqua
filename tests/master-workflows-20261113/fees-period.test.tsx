// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner: async () => ({permissions:new Set(["reports.financial"])}), requirePagePermission: vi.fn()}));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({isLiveOwnerForSettings: async () => false}));
// This period-control unit fixture supplies an authorised named facility;
// live cross-tenant/site refusal is exercised by selected-facility-access tests.
vi.mock("@/lib/services/selected-facility-access", () => ({canSelectFacility: async () => true}));
vi.mock("@/lib/auth/permission", () => ({hasPermission: () => false}));
vi.mock("next/headers", () => ({cookies: async () => ({get: () => undefined})}));
vi.mock("@/lib/actions/tenant-timezone", () => ({getTenantTimezoneAction: async () => "Asia/Kolkata"}));
vi.mock("@/db/tenant", () => ({withTenant: async () => [{timezone:"Asia/Kolkata"}]}));
vi.mock("@/lib/actions/terminology", () => ({getTerminologyAction: async () => ({overrides:{},locale:"en"})}));
vi.mock("@/lib/actions/membership-plans", () => ({listPlansAction: async () => []}));
const ledger = vi.hoisted(() => ({total:0,truncated:false}));
vi.mock("@/lib/actions/fees-hub", () => ({
  getFeesOverviewAction: async () => ({collectedPaise:0,paymentCount:0,reversedPaise:0,reversalCount:0,outstandingPaise:0,dueInvoiceCount:0,overduePaise:0,overdueInvoiceCount:0,today:"2026-11-13",overdueAgeing:[]}),
  listHubInvoicesAction: async () => [],
  listHubTransactionsAction: async () => ({rows:[],totalCount:ledger.total,truncated:ledger.truncated,limit:200}),
}));
vi.mock("next/navigation", () => ({useRouter: () => ({refresh:vi.fn()})}));
import FeesPage from "@/app/(owner)/owner/fees/page";
import { FeesPeriodControl } from "@/components/fees/fees-period-control";
afterEach(() => { cleanup(); vi.useRealTimers(); ledger.total=0;ledger.truncated=false; });
function openDates() { fireEvent.click(screen.getByRole("button", {name:"Change dates"})); }
function appliedQuery() { return new URLSearchParams(Array.from(new FormData(screen.getByRole("form", {name:"Collection period"}) as HTMLFormElement), ([key,value])=>[key,String(value)])); }
it("offers a labelled date range on transactions and keeps the facility on submission", async () => {
  render(await FeesPage({searchParams:Promise.resolve({tab:"transactions",from:"2026-11-01",to:"2026-12-01",facility:"11111111-1111-4111-8111-111111111111"})}));
  openDates();
  expect(screen.getByLabelText("From date")).toBeTruthy();
  expect(screen.getByLabelText("Through date")).toBeTruthy();
  const form = screen.getByRole("button",{name:/apply period/i}).closest("form")!;
  expect(form.querySelector('input[name="facility"]')?.getAttribute("value")).toBe("11111111-1111-4111-8111-111111111111");
});
it("adopts the applied period when Back restores a previous range", () => {
  const props = {tab:"transactions" as const,from:"2026-11-01",to:"2026-12-01",facility:"all",timezone:"Asia/Kolkata",method:"upi",group:"digital"};
  const view = render(<FeesPeriodControl {...props} />);
  view.rerender(<FeesPeriodControl {...props} from="2026-10-01" to="2026-11-01" />);
  openDates();
  expect((screen.getByLabelText("From date") as HTMLInputElement).value).toBe("01/10/2026");
  expect((screen.getByLabelText("Through date") as HTMLInputElement).value).toBe("31/10/2026");
  expect(fireEvent.submit(screen.getByRole("form", {name:"Collection period"}))).toBe(true);
  const query = appliedQuery();
  expect(query.get("from")).toBe("2026-10-01");
  expect(query.get("to")).toBe("2026-11-01");
  expect(query.get("tab")).toBe("transactions");
  expect(query.get("facility")).toBe("all");
  expect(query.get("method")).toBe("upi");
  expect(query.get("group")).toBe("digital");
});
it("uses inclusive calendar days and preserves filters at the year boundary", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-01-01T00:15:00+05:30"));
  render(<FeesPeriodControl tab="transactions" from="2026-12-01" to="2027-01-01" facility="all" timezone="Asia/Kolkata" method="upi" group="digital" />);
  openDates();
  const query = new URL(screen.getByRole("link",{name:"Last month"}).getAttribute("href")!, "http://localhost").searchParams;
  expect(query.get("from")).toBe("2026-12-01");
  expect(query.get("to")).toBe("2027-01-01");
  expect(query.get("facility")).toBe("all");
  expect(query.get("method")).toBe("upi");
  expect(query.get("group")).toBe("digital");
});
it("discloses when the selected period's ledger is capped", async () => {
  ledger.total=201; ledger.truncated=true;
  render(await FeesPage({searchParams:Promise.resolve({tab:"transactions",from:"2026-11-01",to:"2026-12-01",facility:"all"})}));
  expect(screen.getByText(/showing the newest 0 of 201 transactions in this period/i)).toBeTruthy();
  expect(screen.getByText(/narrow the period/i)).toBeTruthy();
});
it("announces an invalid date range using neutral error text", () => {
  render(<FeesPeriodControl tab="transactions" from="2026-11-01" to="2026-12-01" timezone="Asia/Kolkata" />);
  openDates();
  fireEvent.change(screen.getByLabelText("From date"),{target:{value:"10/12/2026"}});
  fireEvent.click(screen.getByRole("button",{name:"Apply period"}));
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Choose a valid date range");
  expect(alert.className).toContain("text-ink-2");
  expect(alert.className).not.toContain("text-late");
});
it("keeps an explicit all-facilities selection across period navigation", async () => {
  render(await FeesPage({searchParams:Promise.resolve({tab:"transactions",from:"2026-11-01",to:"2026-12-01",facility:"all"})}));
  openDates();
  expect(fireEvent.submit(screen.getByRole("form", {name:"Collection period"}))).toBe(true);
  expect(appliedQuery().get("facility")).toBe("all");
});
it.each(["overview", "transactions"])("shows one applied range on %s instead of duplicating it above and below the tabs", async (tab) => {
  render(await FeesPage({searchParams:Promise.resolve({tab,from:"2026-11-01",to:"2026-12-01",facility:"all"})}));
  expect(screen.getAllByText(/1 Nov 2026 – 30 Nov 2026/)).toHaveLength(1);
});
