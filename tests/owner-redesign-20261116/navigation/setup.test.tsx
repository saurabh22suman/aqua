// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({ tenantId: "tenant", userId: "user", roleKey: "owner", features: new Set(), permissions: new Set(["settings.manage", "settings.read", "dashboard.view"]) }),
  requirePagePermission: () => {},
}));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => {} }));
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: async () => null }));
vi.mock("@/lib/services/branding", () => ({ getBranding: async () => ({ displayName: null, fallbackDisplayName: "Synthetic club" }) }));
vi.mock("@/lib/actions/locations", () => ({ listAdminLocationsAction: async () => [] }));
vi.mock("@/lib/actions/onboarding-checklist", () => ({ getOnboardingChecklistAction: async () => null }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
vi.mock("@/components/staff-club-install-link", () => ({ StaffClubInstallLink: () => null }));
import SettingsPage from "@/app/(owner)/owner/settings/page";

afterEach(cleanup);
it("offers one optional setup path without repeating its five task links", async () => {
  render(await SettingsPage({ searchParams: Promise.resolve({}) }));
  const helpLinks = screen.getAllByRole("link", { name: "Help: open guide" });
  expect(helpLinks).toHaveLength(1);
  expect(helpLinks[0].getAttribute("href")).toBe("/owner#workspace-guide");
  expect(screen.queryByText("Club setup")).toBeNull();
  expect(screen.queryByText("1. Physical facilities")).toBeNull();
});
