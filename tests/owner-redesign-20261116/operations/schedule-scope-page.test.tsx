// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({ cookie: undefined as string | undefined, allowed: true, grid: vi.fn<(...args: unknown[]) => Promise<never[]>>().mockResolvedValue([]), props: vi.fn() }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "tenant", permissions: new Set(["attendance.read"]) }), requirePagePermission: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie === undefined ? undefined : { value: state.cookie } }) }));
vi.mock("@/lib/services/selected-facility-access", () => ({ canSelectFacility: async () => state.allowed }));
vi.mock("@/lib/services/people", () => ({ listLocations: async () => [] }));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/db/tenant", () => ({ withTenant: async () => [{ timezone: "Asia/Kolkata" }] }));
vi.mock("@/lib/actions/schedule-grid", () => ({ getScheduleGridAction: state.grid }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({locale:"en",overrides:{}}) }));
vi.mock("@/lib/services/coach-schedule", () => ({ listUpcomingSessions: async () => [] }));
vi.mock("@/lib/terminology/keys", async (original) => ({ ...await original<typeof import("@/lib/terminology/keys")>(), resolveTerm: () => "batch" }));
vi.mock("@/components/owner-schedule-grid", () => ({ OwnerScheduleGrid: (props: unknown) => { state.props(props); return <div>Grid</div>; } }));
import Page from "@/app/(owner)/owner/schedule/page";
afterEach(() => { cleanup(); state.cookie = undefined; state.allowed = true; state.grid.mockClear(); state.props.mockClear(); });
it("gives canonical facility precedence and keeps it in schedule navigation", async () => {
  state.cookie = A;
  render(await Page({ searchParams: Promise.resolve({ facility: B, location: A }) }));
  expect(state.grid).toHaveBeenCalledWith(expect.objectContaining({ locationId: B }));
  expect(state.props).toHaveBeenCalledWith(expect.objectContaining({ locationId: B, nextHref: expect.stringContaining(`facility=${B}`) }));
});
it.each([{ facility: "all" }, { location: "" }])("respects explicit all instead of a cookie: %j", async (params) => {
  state.cookie = A;
  render(await Page({ searchParams: Promise.resolve(params) }));
  expect(state.grid).toHaveBeenCalledWith(expect.not.objectContaining({ locationId: expect.anything() }));
  expect(state.props).toHaveBeenCalledWith(expect.objectContaining({ nextHref: expect.stringContaining("facility=all") }));
});
it.each(["bad-id", A])("refuses invalid or denied facility %s without reading the grid", async (facility) => {
  state.allowed = false;
  render(await Page({ searchParams: Promise.resolve({ facility }) }));
  expect(screen.getByRole("heading", { name: "Club unavailable" })).toBeTruthy();
  expect(state.grid).not.toHaveBeenCalled();
});
