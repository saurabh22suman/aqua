// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "tenant", userId: "user", roleKey: "owner", features: new Set(), permissions: new Set(["settings.manage", "settings.read"]) }), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => {} }));
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: async () => null }));
vi.mock("@/lib/services/branding", () => ({ getBranding: async () => ({ displayName: null, fallbackDisplayName: "Synthetic club" }) }));
vi.mock("@/lib/actions/locations", () => ({ listAdminLocationsAction: async () => [] }));
vi.mock("@/lib/actions/onboarding-checklist", () => ({ getOnboardingChecklistAction: async () => null }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
vi.mock("@/components/staff-club-install-link", () => ({ StaffClubInstallLink: () => null }));
vi.mock("@/components/onboarding/optional-workspace-guide", () => ({ OptionalWorkspaceGuide: () => null }));
import SettingsPage from "@/app/(owner)/owner/settings/page";

afterEach(cleanup);
it("names the business wrapper and clubs distinctly in the category", async () => {
  render(await SettingsPage({ searchParams: Promise.resolve({ category: "academy" }) }));
  expect(screen.getByRole("heading", { name: "Business account", level: 1 })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open Business profile & default billing" }).getAttribute("href")).toBe("/owner/settings/academy");
  expect(screen.getByRole("link", { name: "Open Club" }).getAttribute("href")).toBe("/owner/settings/locations");
  expect(screen.getByRole("link", { name: "Open Business branding" }).getAttribute("href")).toBe("/owner/settings/branding");
  expect(screen.getByRole("link", { name: "Open Academy rules" }).getAttribute("href")).toBe("/owner/settings/configuration");
});
it("opens compact category tasks and retains every destination in the category", async () => {
  render(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("link", { name: /Open Business account settings/i }).getAttribute("href")).toBe("/owner/settings?category=academy");
  cleanup();
  render(await SettingsPage({ searchParams: Promise.resolve({ category: "academy" }) }));
  expect(screen.getByRole("link", { name: /Open Business profile & default billing/i }).getAttribute("href")).toBe("/owner/settings/academy");
  expect(screen.getByRole("link", { name: /Open Vocabulary/i }).getAttribute("href")).toBe("/owner/settings/terminology");
});
