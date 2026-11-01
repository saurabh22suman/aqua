// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ctx: { tenantId: "tenant-a", userId: "user-a", permissions: new Set<string>(), features: new Set<string>() },
  owner: vi.fn(), terminology: vi.fn(), cookie: "",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("denied"); } }));
vi.mock("@/lib/auth/surface-guard", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/surface-guard")>(), requireOwner: state.owner,
}));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: state.terminology }));
import ReportPreferencesPage from "@/app/(owner)/owner/settings/reports/page";
type Assert<T extends true> = T;
export type PreferencesPagePropsContract = Assert<undefined extends Parameters<typeof ReportPreferencesPage>[0] ? false : true>;

beforeEach(() => {
  state.ctx.permissions = new Set(["reports.operational"]);
  state.ctx.features = new Set(["reports", "billing"]);
  state.owner.mockReset().mockResolvedValue(state.ctx);
  state.terminology.mockReset().mockResolvedValue({ locale: "en", overrides: {} });
  state.cookie = "";
});

it.each([
  ["all", "all"],
  ["22222222-2222-4222-8222-222222222222", "22222222-2222-4222-8222-222222222222"],
])("keeps explicit %s ahead of the remembered facility on the Reports Back link", async (facility, expected) => {
  state.cookie = "11111111-1111-4111-8111-111111111111";
  render(await ReportPreferencesPage({ searchParams: Promise.resolve({ facility }) }));
  expect(screen.getByRole("link", { name: "Reports" }).getAttribute("href")).toBe(`/owner/reports?facility=${expected}`);
});

it.each(["all", "22222222-2222-4222-8222-222222222222"])("keeps explicit %s in the reports-disabled branch without loading terminology", async facility => {
  state.cookie = "11111111-1111-4111-8111-111111111111";
  state.ctx.features.delete("reports");
  render(await ReportPreferencesPage({ searchParams: Promise.resolve({ facility }) }));
  expect(screen.getByRole("link", { name: "Reports" }).getAttribute("href")).toBe(`/owner/reports?facility=${facility}`);
  expect(screen.queryAllByRole("switch")).toHaveLength(0);
  expect(state.terminology).not.toHaveBeenCalled();
});

it("uses a remembered facility when the URL has no explicit choice", async () => {
  state.cookie = "11111111-1111-4111-8111-111111111111";
  render(await ReportPreferencesPage({}));
  expect(screen.getByRole("link", { name: "Reports" }).getAttribute("href")).toBe(`/owner/reports?facility=${state.cookie}`);
});

it("uses the valid cookie when an invalid facility is supplied, never echoing arbitrary input", async () => {
  state.cookie = "11111111-1111-4111-8111-111111111111";
  render(await ReportPreferencesPage({ searchParams: Promise.resolve({ facility: "not-a-uuid" }) }));
  expect(screen.getByRole("link", { name: "Reports" }).getAttribute("href")).toBe(`/owner/reports?facility=${state.cookie}`);
});

it("uses explicit all when neither URL nor cookie identifies a facility", async () => {
  render(await ReportPreferencesPage({}));
  expect(screen.getByRole("link", { name: "Reports" }).getAttribute("href")).toBe("/owner/reports?facility=all");
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

it("guards before displaying choices and limits staff and money to permitted users", async () => {
  render(await ReportPreferencesPage({}));
  expect(state.owner).toHaveBeenCalledOnce();
  for (const label of ["Attendance", "Members", "Batches"]) expect(screen.getByRole("switch", { name: label })).toBeTruthy();
  expect(screen.queryByRole("switch", { name: "Staff" })).toBeNull();
  expect(screen.queryByRole("switch", { name: "Collections" })).toBeNull();
});

it("uses authenticated tenant and user identity for persistence", async () => {
  render(await ReportPreferencesPage({}));
  screen.getByRole("switch", { name: "Members" }).click();
  expect(window.localStorage.getItem("aqua:owner-report-preferences:tenant-a:user-a")).not.toBeNull();
});

it("does not expose choices when operational permission is denied", async () => {
  state.ctx.permissions.clear();
  await expect(ReportPreferencesPage({})).rejects.toThrow("denied");
  expect(state.terminology).not.toHaveBeenCalled();
});

it("uses the club's configured terms for member and batch families", async () => {
  state.terminology.mockResolvedValue({ locale: "en", overrides: { member: { en: { one: "Swimmer", other: "Swimmers" } }, batch: { en: { one: "Group", other: "Groups" } } } });
  render(await ReportPreferencesPage({}));
  expect(screen.getByRole("switch", { name: "Swimmers" })).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Groups" })).toBeTruthy();
});

it("only offers staff and collections with their required grants and entitlements", async () => {
  state.ctx.permissions.add("staff.attendance");
  state.ctx.permissions.add("reports.financial");
  state.ctx.permissions.add("invoices.read");
  render(await ReportPreferencesPage({}));
  expect(screen.getByRole("switch", { name: "Staff" })).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Collections" })).toBeTruthy();
  cleanup();
  state.ctx.features.delete("billing");
  render(await ReportPreferencesPage({}));
  expect(screen.queryByRole("switch", { name: "Collections" })).toBeNull();
});

it("withholds financial choices without invoice access and withholds all options when reports are disabled", async () => {
  state.ctx.permissions.add("reports.financial");
  render(await ReportPreferencesPage({}));
  expect(screen.queryByRole("switch", { name: "Collections" })).toBeNull();
  cleanup();
  state.terminology.mockClear();
  state.ctx.features.delete("reports");
  render(await ReportPreferencesPage({}));
  expect(screen.queryAllByRole("switch")).toHaveLength(0);
  expect(state.terminology).not.toHaveBeenCalled();
});
