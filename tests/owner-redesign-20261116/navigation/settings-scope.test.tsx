// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { fixture } from "@/tests/remediation-20261112/fixture";

const env = vi.hoisted(() => ({ ctx: null as unknown, locations: [] as { id: string; name: string }[] }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => env.ctx, requirePagePermission: () => {} }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => {} }));
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: async () => null }));
vi.mock("@/lib/actions/locations", () => ({ listAdminLocationsAction: async () => env.locations }));
vi.mock("@/lib/actions/onboarding-checklist", () => ({ getOnboardingChecklistAction: async () => null }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
vi.mock("@/components/staff-club-install-link", () => ({ StaffClubInstallLink: () => null }));
vi.mock("@/components/onboarding/optional-workspace-guide", () => ({ OptionalWorkspaceGuide: () => null }));
import SettingsPage from "@/app/(owner)/owner/settings/page";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  env.locations = [{ id: f.locationA, name: "A" }, { id: f.locationB, name: "B" }];
  env.ctx = { ...f.context(), allLocations: false, locationIds: [f.locationA] };
  await f.admin.query("update tenants set branding=$2 where id=$1", [f.tenantId, { displayName: "Club Alpha" }]);
});
afterAll(async () => { cleanup(); await f?.cleanup(); });

it("shows the branded club account", async () => {
  render(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Club Alpha")).toBeTruthy();
  cleanup();
});
it("offers only the facilities visible to the shell", async () => {
  render(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("link", { name: /Club: A/i })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Club: B/i })).toBeNull();
  cleanup();
});
