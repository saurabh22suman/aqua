// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  owner: vi.fn(), charts: vi.fn(), locations: vi.fn(), scopedLocations: vi.fn(), access: vi.fn(), timezone: vi.fn(), terminology: vi.fn(),
  permissions: new Set<string>(), features: new Set<string>(), cookie: "",
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("denied"); } }));
vi.mock("@/lib/auth/surface-guard", async original => ({ ...await original<typeof import("@/lib/auth/surface-guard")>(), requireOwner: state.owner }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@/lib/services/owner-home-charts", () => ({ getOwnerCharts: state.charts }));
vi.mock("@/lib/actions/people", () => ({ listLocationsAction: state.locations }));
vi.mock("@/lib/services/people", () => ({ listLocations: state.scopedLocations }));
vi.mock("@/db/tenant", () => ({ withTenant: async (_tenant: unknown, fn: (tx: object) => unknown) => fn({}) }));
vi.mock("@/lib/services/location-access", () => ({ resolveLocationAccess: state.access }));
vi.mock("@/lib/services/tenant-timezone", () => ({ tenantTimezoneInTx: state.timezone }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: state.terminology }));
vi.mock("@/components/reports/collections-report", () => ({ CollectionsReport: ({ canConfirm, canReopen, initialLocationId, locations }: { canConfirm: boolean; canReopen: boolean; initialLocationId?: string; locations: { id: string }[] }) => <><p>Daily close form {String(canConfirm)} {String(canReopen)}</p><p data-testid="initial-location">{initialLocationId ?? "default"}</p><p data-testid="available-locations">{locations.map(location => location.id).join(",")}</p></> }));
import CollectionsPage from "@/app/(owner)/owner/reports/collections/page";

const facility = "11111111-1111-4111-8111-111111111111";
const ctx = { tenantId: "tenant", userId: "user", roleKey: "owner", allLocations: true, locationIds: [], permissions: state.permissions, features: state.features };
const data = { period: { key: "last7", currentFromDate: "2026-10-26", currentToDate: "2026-11-01", tabLabel: "Last 7 days" }, collections: { totalPaise: 123456, paymentCount: 3, reversedPaise: 20000, reversalCount: 1, buckets: [{ key: "2026-10-26", label: "26 Oct", fullLabel: "26 Oct", totalPaise: 123456, cash: 123456, digital: 0, other: 0 }], methods: [{ key: "cash", label: "Cash", group: "cash", paise: 123456, count: 3, pct: 100 }] } };
const props = (value: { view?: string; period?: string; facility?: string } = {}) => ({ searchParams: Promise.resolve(value) });
beforeEach(() => {
  state.permissions.clear(); state.permissions.add("reports.financial"); state.permissions.add("invoices.read");
  state.features.clear(); state.features.add("reports"); state.features.add("billing");
  state.owner.mockReset().mockResolvedValue(ctx);
  state.charts.mockReset().mockResolvedValue(data);
  state.locations.mockReset().mockResolvedValue([]);
  state.scopedLocations.mockReset().mockResolvedValue([]);
  state.access.mockReset().mockResolvedValue({ unrestricted: true });
  state.timezone.mockReset().mockResolvedValue("Asia/Kolkata");
  state.terminology.mockReset().mockResolvedValue({ locale: "en", overrides: {} });
  state.cookie = "";
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps the old URL on the daily close and preserves action permissions", async () => {
  state.permissions.add("payments.record");
  render(await CollectionsPage(props()));
  expect(screen.getByText("Daily close form true false")).toBeTruthy();
  expect(state.charts).not.toHaveBeenCalled();
});

it("allows financial-only Daily close without the unrelated members.read action", async () => {
  state.locations.mockRejectedValue(new Error("members.read denied"));
  render(await CollectionsPage(props()));
  expect(state.scopedLocations).toHaveBeenCalledWith(ctx);
  expect(screen.getByText("Daily close form false false")).toBeTruthy();
});

it("only offers sites within the resolved location access", async () => {
  const other = "22222222-2222-4222-8222-222222222222";
  state.scopedLocations.mockResolvedValue([{ id: facility, name: "A" }, { id: other, name: "B" }]);
  state.access.mockResolvedValue({ unrestricted: false, locationIds: [other] });
  render(await CollectionsPage(props({ facility })));
  expect(screen.getByTestId("initial-location").textContent).toBe(facility);
  expect(screen.getByTestId("available-locations").textContent).toBe(other);
});

it("loads last-seven trends with the full authenticated context and selected facility", async () => {
  state.cookie = facility;
  render(await CollectionsPage(props({ view: "trends" })));
  expect(state.charts).toHaveBeenCalledWith(ctx, { period: "last7", locationId: facility });
  expect(screen.getByRole("heading", { name: "Collections report" })).toBeTruthy();
  expect(screen.queryByText(/Daily close form/)).toBeNull();
});

it("carries the requested site to Daily close and preserves scope in Trends navigation", async () => {
  state.cookie = "22222222-2222-4222-8222-222222222222";
  const view = render(await CollectionsPage(props({ facility })));
  expect(screen.getByTestId("initial-location").textContent).toBe(facility);
  view.unmount();
  render(await CollectionsPage(props({ view: "trends", facility })));
  expect(screen.getByRole("link", { name: "Daily close" }).getAttribute("href")).toContain(`facility=${facility}`);
  expect(screen.getByRole("link", { name: "All reports" }).getAttribute("href")).toContain(`facility=${facility}`);
});

it("uses explicit all rather than a stale site cookie for legacy Daily close", async () => {
  state.cookie = facility;
  render(await CollectionsPage(props({ facility: "all" })));
  expect(screen.getByTestId("initial-location").textContent).toBe("default");
});

it("preserves an all-scope Trends choice when entering Daily close", async () => {
  state.cookie = facility;
  render(await CollectionsPage(props({ view: "trends", facility: "all" })));
  expect(screen.getByRole("link", { name: "Daily close" }).getAttribute("href")).toContain("facility=all");
});

it.each([["all", undefined], ["22222222-2222-4222-8222-222222222222", "22222222-2222-4222-8222-222222222222"]])("preserves explicit %s when applying a range against a stale cookie", async (scope, locationId) => {
  state.cookie = facility;
  const view = render(await CollectionsPage(props({ view: "trends", facility: scope })));
  const form = screen.getByRole("button", { name: "Apply" }).closest("form")!;
  const submitted = Object.fromEntries(new FormData(form));
  expect(submitted.facility).toBe(scope);
  expect(screen.getByRole("link", { name: "All reports" }).getAttribute("href")).toContain(`facility=${scope}`);
  expect(screen.getByRole("link", { name: "Daily close" }).getAttribute("href")).toContain(`facility=${scope}`);
  view.unmount(); state.charts.mockClear();
  await CollectionsPage(props({ view: String(submitted.view), period: String(submitted.period), facility: String(submitted.facility) }));
  expect(state.charts).toHaveBeenCalledWith(ctx, { period: "last7", ...(locationId ? { locationId } : {}) });
});

it("refuses page access before any read without financial permission", async () => {
  state.permissions.delete("reports.financial");
  await expect(CollectionsPage(props({ view: "trends" }))).rejects.toThrow("denied");
  expect(state.charts).not.toHaveBeenCalled();
  expect(state.scopedLocations).not.toHaveBeenCalled();
  expect(state.access).not.toHaveBeenCalled();
});

it("keeps daily close available without invoice access and does not query trends", async () => {
  state.permissions.delete("invoices.read");
  render(await CollectionsPage(props({ view: "trends" })));
  expect(state.charts).not.toHaveBeenCalled();
  expect(screen.getByText(/trends unavailable/i)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Daily close" })).toBeTruthy();
});

it("passes explicit period and URL facility, and shows captured and reversed amounts separately", async () => {
  state.cookie = "22222222-2222-4222-8222-222222222222";
  render(await CollectionsPage(props({ view: "trends", period: "month", facility })));
  expect(state.charts).toHaveBeenCalledWith(ctx, { period: "month", locationId: facility });
  expect(screen.getAllByText("₹1,234.56").length).toBeGreaterThan(0);
  expect(screen.getByText(/₹200/)).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/expenses/i);
});

it("shows an error instead of empty data when the read fails", async () => {
  state.charts.mockRejectedValue(new Error("broken"));
  render(await CollectionsPage(props({ view: "trends" })));
  expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
  expect(screen.queryByText(/no payments recorded/i)).toBeNull();
});

it("does not read trends when a required feature is disabled", async () => {
  state.features.delete("billing");
  render(await CollectionsPage(props({ view: "trends" })));
  expect(state.charts).not.toHaveBeenCalled();
  expect(screen.getByText(/trends unavailable/i)).toBeTruthy();
});

it("rejects an invalid period rather than widening the query", async () => {
  render(await CollectionsPage(props({ view: "trends", period: "invalid" })));
  expect(state.charts).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/invalid range/i);
});

it("shows an honest empty state but still reports separate reversals", async () => {
  state.charts.mockResolvedValue({ ...data, collections: { ...data.collections, totalPaise: 0, paymentCount: 0, buckets: [], methods: [] } });
  render(await CollectionsPage(props({ view: "trends" })));
  expect(screen.getByText(/no payments recorded/i)).toBeTruthy();
  expect(screen.getByText(/Reversals: ₹200/)).toBeTruthy();
  expect(screen.queryByRole("img", { name: "Recorded payments by method" })).toBeNull();
});

it("uses seven actual daily buckets and exposes exact values in a table", async () => {
  const buckets = ["26 Oct", "27 Oct", "28 Oct", "29 Oct", "30 Oct", "31 Oct", "1 Nov"].map(label => ({ key: label, label, fullLabel: label, totalPaise: 10000, cash: 10000, digital: 0, other: 0 }));
  state.charts.mockResolvedValue({ ...data, collections: { ...data.collections, buckets } });
  render(await CollectionsPage(props({ view: "trends" })));
  expect(screen.getByRole("img", { name: /collections by date/i }).querySelectorAll("rect")).toHaveLength(7);
  expect(screen.getByRole("table", { name: "Exact collections by date", hidden: true }).querySelectorAll("tbody tr")).toHaveLength(7);
});

it("shows the day total without exposing hourly bucket labels", async () => {
  state.charts.mockResolvedValue({ ...data, period: { ...data.period, key: "day", currentFromDate: "2026-11-01", currentToDate: "2026-11-01" }, collections: { ...data.collections, buckets: [{ key: "10", label: "10:00", fullLabel: "2026-11-01 10:00", totalPaise: 123456 }] } });
  render(await CollectionsPage(props({ view: "trends", period: "day" })));
  expect(document.body.textContent).not.toContain("10:00");
  expect(screen.getByRole("img", { name: /collections by date/i }).querySelectorAll("rect")).toHaveLength(1);
});
