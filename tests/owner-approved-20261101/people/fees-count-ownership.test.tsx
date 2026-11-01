// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
afterEach(cleanup);

it("shows the recorded payment count with collections rather than duplicating it in another KPI", async () => {
  render(await FeesPage({ searchParams: Promise.resolve({ tab: "overview", from: "2026-10-01", to: "2026-10-31" }) }));
  expect(screen.getByText(/2 payments captured at the counter/i)).toBeTruthy();
  expect(screen.queryByText("Payments in this period")).toBeNull();
  expect(screen.getByRole("link", { name: /collected in this period/i }).getAttribute("href")).toContain("tab=transactions");
});
