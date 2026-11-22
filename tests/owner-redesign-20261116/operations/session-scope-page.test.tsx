// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({ cookie: undefined as string | undefined, allowed: true, list: vi.fn<(...args: unknown[]) => Promise<never[]>>().mockResolvedValue([]), check: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "tenant", permissions: new Set(["programs.write", "attendance.read"]) }), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ({ tenantId: "tenant", permissions: new Set(["programs.write", "attendance.read"]) }) }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: (ctx: { permissions: Set<string> }, key: string) => ctx.permissions.has(key) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie === undefined ? undefined : { value: state.cookie } }) }));
vi.mock("@/lib/services/selected-facility-access", () => ({ canSelectFacility: async (...args: unknown[]) => { await state.check(...args); return state.allowed; } }));
vi.mock("@/lib/services/coach-schedule", () => ({ listUpcomingSessions: state.list }));
vi.mock("@/lib/services/programs", () => ({ listCoaches: async () => [] }));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ overrides: {}, locale: "en" }) }));
vi.mock("@/components/upcoming-sessions-list", () => ({ UpcomingSessionsList: () => <div>Sessions list</div> }));
import Page from "@/app/(owner)/owner/sessions/page";

afterEach(() => { cleanup(); state.cookie = undefined; state.allowed = true; state.list.mockClear(); state.check.mockClear(); });
it("lets explicit all override the cookie and retains all in schedule and programs links", async () => {
  state.cookie = A;
  render(await Page({ searchParams: Promise.resolve({ facility: "all" }) }));
  expect(state.list).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(String), undefined);
  expect(screen.getByRole("link", { name: /schedule grid/i }).getAttribute("href")).toContain("facility=all");
  expect(screen.getByRole("link", { name: /programs/i }).getAttribute("href")).toContain("facility=all");
});
it("uses explicit facility before legacy location and cookie", async () => {
  state.cookie = A;
  render(await Page({ searchParams: Promise.resolve({ facility: B, location: A }) }));
  expect(state.check).toHaveBeenCalledWith(expect.anything(), B);
  expect(state.list).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(String), B);
});
it("uses the legacy location before a cookie and then uses the cookie when absent", async () => {
  state.cookie = A;
  render(await Page({ searchParams: Promise.resolve({ location: B }) }));
  expect(state.list).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(String), B);
  cleanup(); state.list.mockClear();
  render(await Page({ searchParams: Promise.resolve({}) }));
  expect(state.list).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(String), A);
});
it.each(["bad-id", A])("refuses malformed or denied selection %s before querying sessions", async (facility) => {
  state.allowed = false;
  render(await Page({ searchParams: Promise.resolve({ facility }) }));
  expect(screen.getByRole("heading", { name: "Facility unavailable" })).toBeTruthy();
  expect(state.list).not.toHaveBeenCalled();
});
