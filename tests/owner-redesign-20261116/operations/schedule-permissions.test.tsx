// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ locations: vi.fn(async () => [{ id: "one", name: "North" }]) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "t", permissions: new Set(["attendance.read"]) }), requirePagePermission: () => {} }));
vi.mock("@/lib/actions/people", () => ({ listLocationsAction: async () => { throw new Error("members.read required"); } }));
vi.mock("@/lib/services/people", () => ({ listLocations: calls.locations }));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/db/tenant", () => ({ withTenant: async () => [{ timezone: "Asia/Kolkata" }] }));
vi.mock("@/lib/actions/schedule-grid", () => ({ getScheduleGridAction: async () => [] }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({locale:"en",overrides:{}}) }));
vi.mock("@/lib/services/coach-schedule", () => ({ listUpcomingSessions: async () => [] }));
vi.mock("@/lib/terminology/keys", async (original) => ({ ...await original<typeof import("@/lib/terminology/keys")>(), resolveTerm: () => "batch" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/components/owner-schedule-grid", () => ({ OwnerScheduleGrid: () => null }));

import OwnerSchedulePage from "@/app/(owner)/owner/schedule/page";

it("loads permitted locations with attendance.read without requiring members.read", async () => {
  await expect(OwnerSchedulePage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
  expect(calls.locations).toHaveBeenCalledOnce();
});
