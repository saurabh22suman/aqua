// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";

const state = vi.hoisted(() => ({
  allowed: true,
  invoices: vi.fn(async () => [] as HubInvoiceRow[]),
  overview: vi.fn(async () => ({
    collectedPaise: 0,
    paymentCount: 0,
    reversedPaise: 0,
    reversalCount: 0,
    outstandingPaise: 0,
    dueInvoiceCount: 0,
    overduePaise: 0,
    overdueInvoiceCount: 0,
    today: "2026-11-20",
    overdueAgeing: [],
  })),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({ permissions: new Set(["reports.financial", "invoices.read"]) }),
  requirePagePermission: vi.fn(),
}));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ isLiveOwnerForSettings: async () => false }));
vi.mock("@/lib/services/selected-facility-access", () => ({ canSelectFacility: async () => state.allowed }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/db/tenant", () => ({ withTenant: async () => [{ timezone: "Asia/Kolkata" }] }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ overrides: {}, locale: "en" }) }));
vi.mock("@/lib/actions/membership-plans", () => ({ listPlansAction: async () => [] }));
vi.mock("@/lib/actions/fees-hub", () => ({
  getFeesOverviewAction: state.overview,
  listHubInvoicesAction: state.invoices,
  listHubTransactionsAction: async () => ({ rows: [], totalCount: 0, truncated: false, limit: 200 }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import FeesPage from "@/app/(owner)/owner/fees/page";
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";

const FACILITY = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  state.invoices.mockClear();
  state.allowed = true;
});

it("opens the overdue Dues subset and preserves its club and period when returning to all dues", async () => {
  const from = "2026-09-01";
  const to = "2026-10-01";
  render(await FeesPage({ searchParams: Promise.resolve({ tab: "dues", overdue: "1", facility: FACILITY, from, to }) }));

  expect(state.invoices).toHaveBeenCalledWith({
    status: "dues",
    overdueOnly: true,
    locationId: FACILITY,
  });
  expect(screen.getByRole("heading", { name: "Overdue invoices" })).toBeTruthy();
  const back = screen.getByRole("link", { name: "View all dues" });
  const target = new URL(back.getAttribute("href")!, "https://example.test");
  expect(target.pathname).toBe("/owner/fees");
  const query = target.searchParams;
  expect([query.get("tab"), query.get("facility"), query.get("from"), query.get("to"), query.get("overdue")])
    .toEqual(["dues", FACILITY, from, to, null]);
});

it("offers the overdue view from all dues without applying reporting dates to debt", async () => {
  const from = "2026-09-01";
  const to = "2026-10-01";
  render(await FeesPage({ searchParams: Promise.resolve({ tab: "dues", facility: FACILITY, from, to }) }));

  const views = screen.getByRole("navigation", { name: "Dues view" });
  expect(within(views).getByRole("link", { name: "View all dues" }).getAttribute("aria-current")).toBe("page");
  const target = new URL(within(views).getByRole("link", { name: "Overdue" }).getAttribute("href")!, "https://example.test");
  expect(Object.fromEntries(target.searchParams)).toEqual({ tab: "dues", overdue: "1", facility: FACILITY, from, to });
  expect(state.invoices).toHaveBeenCalledWith({ status: "dues", locationId: FACILITY });
});

it("ignores overdue on another tab and on an unrecognised value", async () => {
  render(await FeesPage({ searchParams: Promise.resolve({ tab: "invoices", overdue: "1" }) }));
  expect(state.invoices).toHaveBeenCalledWith({ status: "all" });
  expect(screen.queryByRole("heading", { name: "Overdue invoices" })).toBeNull();
  cleanup();
  state.invoices.mockClear();

  render(await FeesPage({ searchParams: Promise.resolve({ tab: "dues", overdue: "true" }) }));
  expect(state.invoices).toHaveBeenCalledWith({ status: "dues" });
  expect(screen.queryByRole("heading", { name: "Overdue invoices" })).toBeNull();
});

it("keeps the overdue subset on an authorized facility recovery link", async () => {
  state.allowed = false;
  render(
    await FeesPage({
      searchParams: Promise.resolve({ tab: "dues", overdue: "1", facility: FACILITY }),
    }),
  );
  const recovery = new URL(
    screen.getByRole("link", { name: "View available clubs" }).getAttribute("href")!,
    "http://localhost",
  );
  expect(recovery.searchParams.get("tab")).toBe("dues");
  expect(recovery.searchParams.get("overdue")).toBe("1");
  expect(recovery.searchParams.get("facility")).toBe("all");
});

it("carries overdueOnly through search and a subset change refetch", async () => {
  render(
    <FeesInvoiceList
      initial={[]}
      filter="dues"
      facility={FACILITY}
      overdueOnly
      canWrite={false}
      canRecord={false}
      canRefund={false}
      canReadPayments={false}
    />,
  );

  fireEvent.change(screen.getByLabelText(/search member, phone or invoice/i), {
    target: { value: "INV-100" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() =>
    expect(state.invoices).toHaveBeenCalledWith({
      status: "dues",
      overdueOnly: true,
      locationId: FACILITY,
      search: "INV-100",
    }),
  );
  cleanup();
  state.invoices.mockClear();

  const { rerender } = render(
    <FeesInvoiceList
      initial={[]}
      filter="dues"
      facility={FACILITY}
      canWrite={false}
      canRecord={false}
      canRefund={false}
      canReadPayments={false}
    />,
  );
  rerender(
    <FeesInvoiceList
      initial={[]}
      filter="dues"
      facility={FACILITY}
      overdueOnly
      canWrite={false}
      canRecord={false}
      canRefund={false}
      canReadPayments={false}
    />,
  );
  await waitFor(() =>
    expect(state.invoices).toHaveBeenCalledWith({
      status: "dues",
      overdueOnly: true,
      locationId: FACILITY,
    }),
  );
});
