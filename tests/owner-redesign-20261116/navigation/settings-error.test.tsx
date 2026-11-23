// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "tenant", userId: "user", roleKey: "owner", features: new Set(), permissions: new Set(["settings.manage"]) }), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => {} }));
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: async () => null }));
vi.mock("@/lib/services/branding", () => ({ getBranding: async () => { throw new Error("unavailable"); } }));
vi.mock("@/lib/actions/locations", () => ({ listAdminLocationsAction: async () => [] }));
vi.mock("@/lib/actions/onboarding-checklist", () => ({ getOnboardingChecklistAction: async () => null }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
vi.mock("@/components/staff-club-install-link", () => ({ StaffClubInstallLink: () => null }));
vi.mock("@/components/onboarding/optional-workspace-guide", () => ({ OptionalWorkspaceGuide: () => null }));
import SettingsPage from "@/app/(owner)/owner/settings/page";
afterEach(cleanup);
it("keeps settings usable and labels unavailable club identity honestly", async () => {
  render(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Business account unavailable")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Retry business account" }).getAttribute("href")).toBe("/owner/settings");
  expect(screen.getByRole("link", { name: "Open Business account settings" })).toBeTruthy();
});
