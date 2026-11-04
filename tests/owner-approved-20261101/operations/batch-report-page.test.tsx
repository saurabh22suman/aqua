// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  ctx: { permissions: new Set(["reports.operational"]), features: new Set(["reports"]) },
  cookie: undefined as string | undefined,
  read: vi.fn(async () => [] as Array<never>),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => state.ctx,
  requirePagePermission: (ctx: typeof state.ctx, key: string) => { if (!ctx.permissions.has(key)) throw new Error("denied"); },
}));
vi.mock("@/lib/services/owner-batch-report", () => ({ getOwnerBatchReport: state.read }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: { batch: { en: { one: "group", other: "groups" } }, facility: { en: { one: "court", other: "courts" } } } }) }));
import BatchesReportPage from "@/app/(owner)/owner/reports/batches/page";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
afterEach(() => { cleanup(); state.ctx.permissions = new Set(["reports.operational"]); state.ctx.features = new Set(["reports"]); state.cookie = undefined; state.read.mockReset(); state.read.mockResolvedValue([]); });

it("shows a current snapshot without inert range or date controls", async () => {
  render(await BatchesReportPage({}));
  expect(screen.getByText(/current reserved places and capacity/i)).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: /range|date/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  expect(document.querySelector('input[type="date"]')).toBeNull();
});
it("uses the tenant's terms in report headings and unavailable scope", async () => {
  const view = render(await BatchesReportPage({}));
  expect(screen.getByRole("heading", {name:"Groups report"})).toBeTruthy();
  expect(screen.getByRole("heading", {name:"Places by group"})).toBeTruthy();
  view.unmount();
  render(await BatchesReportPage({ searchParams: Promise.resolve({facility:"invalid"}) }));
  expect(screen.getByRole("alert").textContent).toMatch(/court selection/i);
});
it("passes the authenticated context and query-over-cookie location to the service", async () => {
  state.cookie = a;
  render(await BatchesReportPage({ searchParams: Promise.resolve({ facility: b }) }));
  expect(state.read).toHaveBeenCalledWith(state.ctx, b);
});
it.each([[b, b], ["all", "all"]])("carries explicit %s scope through both report links", async (selected, expected) => {
  state.cookie = a;
  state.ctx.permissions = new Set(["reports.operational", "reports.financial", "invoices.read"]);
  state.ctx.features.add("billing");
  render(await BatchesReportPage({ searchParams: Promise.resolve({ facility: selected }) }));
  expect(state.read).toHaveBeenCalledWith(state.ctx, selected === "all" ? undefined : selected);
  expect(screen.getByRole("link", {name:/all reports/i}).getAttribute("href")).toBe(`/owner/reports?facility=${expected}`);
  expect(screen.getByRole("link", {name:/daily collections/i}).getAttribute("href")).toBe(`/owner/reports/collections?facility=${expected}`);
});
it("fails closed on an invalid explicit facility instead of falling back to a cookie", async () => {
  state.cookie = a;
  render(await BatchesReportPage({ searchParams: Promise.resolve({ facility: "invalid" }) }));
  expect(state.read).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeTruthy();
});
it("denies a caller without operational permission before reading", async () => {
  state.ctx.permissions = new Set();
  await expect(BatchesReportPage({})).rejects.toThrow("denied");
  expect(state.read).not.toHaveBeenCalled();
});
it("shows read errors instead of a false empty result", async () => {
  state.read.mockRejectedValueOnce(new Error("read failed"));
  render(await BatchesReportPage({}));
  expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/i);
  expect(screen.queryByText(/no batches/i)).toBeNull();
});
it("only offers the financial destination with both grants and entitlements", async () => {
  const view = render(await BatchesReportPage({}));
  expect(screen.queryByRole("link", { name: /daily collections/i })).toBeNull();
  view.unmount(); state.ctx.permissions.add("reports.financial"); state.ctx.permissions.add("invoices.read"); state.ctx.features.add("billing");
  render(await BatchesReportPage({}));
  expect(screen.getByRole("link", { name: /daily collections/i }).getAttribute("href")).toBe("/owner/reports/collections?facility=all");
});
it.each([
  ["invoice grant", ["reports.operational", "reports.financial"], ["reports", "billing"]],
  ["financial grant", ["reports.operational", "invoices.read"], ["reports", "billing"]],
  ["billing entitlement", ["reports.operational", "reports.financial", "invoices.read"], ["reports"]],
  ["reports entitlement", ["reports.operational", "reports.financial", "invoices.read"], ["billing"]],
])("withholds daily collections without %s", async (_label, permissions, features) => {
  state.ctx.permissions = new Set(permissions); state.ctx.features = new Set(features);
  render(await BatchesReportPage({}));
  expect(screen.queryByRole("link", { name: /daily collections/i })).toBeNull();
});
