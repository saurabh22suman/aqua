// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ roleKey: "owner", tenantId: "tenant-1", userId: "user-1", permissions: new Set(["reports.financial", "settings.manage", "invoices.write", "payments.record", "payments.read", "payments.refund"]), features: new Set(["fees"]) }), requirePagePermission: (ctx: { permissions: Set<string> }, key: string) => { if (!ctx.permissions.has(key)) throw new Error("forbidden"); } }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: (ctx: { permissions: Set<string> }, key: string) => ctx.permissions.has(key), hasFeature: (ctx: { features: Set<string> }, key: string) => ctx.features.has(key) }));
vi.mock("@/lib/actions/fees-hub", () => ({
  getFeesOverviewAction: async () => ({ collectedPaise: 700000, paymentCount: 2, reversedPaise: 0, reversalCount: 0, outstandingPaise: 900000, dueInvoiceCount: 2, overduePaise: 123400, overdueInvoiceCount: 1, overdueAgeing: [], today: "2026-11-01" }),
  listHubInvoicesAction: async () => [], listHubTransactionsAction: async () => ({ rows: [], totalCount: 0, truncated: false, limit: 200 }),
}));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ overrides: {}, locale: "en" }) }));
vi.mock("@/lib/actions/membership-plans", () => ({ listPlansAction: async () => [] }));
vi.mock("@/lib/actions/invoices", () => ({ createInvoiceAction: vi.fn(), listMemberInvoicesAction: vi.fn(), getInvoiceAction: vi.fn(), voidInvoiceAction: vi.fn() }));
vi.mock("@/lib/actions/subscriptions", () => ({ listMemberSubscriptionsAction: vi.fn() }));
vi.mock("@/lib/actions/payments", () => ({ listInvoicePaymentsAction: vi.fn(), recordPaymentAction: vi.fn() }));
import FeesPage from "@/app/(owner)/owner/fees/page";
import { formatINR } from "@/lib/money/format";
afterEach(cleanup);

it("groups current liabilities separately from the period collection and states the period concisely", async () => {
  render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview", from: "2026-10-01", to: "2026-11-01" }) }));
  const current = screen.getByRole("group", { name: "Current balances" });
  const collection = screen.getByRole("group", { name: "Period collections" });
  expect(within(current).getByText("Outstanding now")).toBeTruthy();
  expect(within(current).getByText("Overdue now")).toBeTruthy();
  expect(within(collection).getByText("Collected in this period")).toBeTruthy();
  expect(within(current).getByText(formatINR(900000))).toBeTruthy();
  expect(within(current).getByText(formatINR(123400))).toBeTruthy();
  expect(within(collection).getByText(formatINR(700000))).toBeTruthy();
  expect(screen.queryByText(/one place over plans/i)).toBeNull();
  expect(screen.getByText(/period 1 oct 2026.*31 oct 2026/i)).toBeTruthy();
});

it("owns the current overdue total once on the overview while retaining the dues action", async () => {
  render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview", from: "2026-10-01", to: "2026-10-31", facility: "loc-1" }) }));
  expect(screen.getAllByText(formatINR(123400), { exact: false })).toHaveLength(1);
  expect(screen.getByRole("link", { name: /review dues/i }).getAttribute("href")).toContain("tab=dues");
});

it("keeps financial evidence and overdue ageing in a closed details disclosure", async () => {
  render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview" }) }));
  const evidence = screen.getByText("Financial evidence").closest("details");
  const ageing = screen.getByText("Overdue ageing").closest("details");
  expect(evidence).not.toBeNull();
  expect(ageing).not.toBeNull();
  expect(evidence?.open).toBe(false);
  expect(ageing?.open).toBe(false);
  expect(screen.getByRole("link", { name: /review dues/i })).toBeTruthy();
});
