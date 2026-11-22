// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const grants = vi.hoisted(() => ({ permissions: new Set(["settings.manage"]), features: new Set<string>() }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "tenant", userId: "user", roleKey: "owner", features: grants.features, permissions: grants.permissions }), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => {} }));
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: async () => null }));
vi.mock("@/lib/services/branding", () => ({ getBranding: async () => ({ displayName: "Real club", fallbackDisplayName: "Club" }) }));
vi.mock("@/lib/actions/locations", () => ({ listAdminLocationsAction: async () => [{ id: "site-a", name: "North" }, { id: "site-b", name: "South" }] }));
vi.mock("@/lib/actions/onboarding-checklist", () => ({ getOnboardingChecklistAction: async () => null }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => <span>Sign out</span> }));
vi.mock("@/components/staff-club-install-link", () => ({ StaffClubInstallLink: () => <span>Install club</span> }));
vi.mock("@/components/onboarding/optional-workspace-guide", () => ({ OptionalWorkspaceGuide: () => <span>Inline setup guide</span> }));
import SettingsPage from "@/app/(owner)/owner/settings/page";
afterEach(() => { cleanup(); grants.permissions = new Set(["settings.manage"]); grants.features = new Set(); });
it("separates club identity, facility choices and personal preferences without a permanent setup guide", async () => {
  render(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Real club")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Club settings" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Club: North" }).getAttribute("href")).toBe("/owner/settings/locations/site-a");
  expect(screen.getByRole("heading", { name: "Business administration" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Personal preferences" })).toBeTruthy();
  expect(screen.queryByText("Inline setup guide")).toBeNull();
  expect(screen.getByText("Install club")).toBeTruthy();
});
it("does not offer club destinations requiring missing grants", async () => {
  render(await SettingsPage({ searchParams: Promise.resolve({ category: "programs" }) }));
  expect(screen.queryByRole("link", { name: "Open Programs & batches" })).toBeNull();
  cleanup();
  render(await SettingsPage({ searchParams: Promise.resolve({ category: "team" }) }));
  expect(screen.queryByRole("link", { name: "Open Staff" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Open Invitations" })).toBeNull();
});
it("keeps destinations when the corresponding grants exist", async () => {
  grants.permissions = new Set(["settings.manage", "staff.read", "staff.invite"]);
  render(await SettingsPage({ searchParams: Promise.resolve({ category: "team" }) }));
  expect(screen.getByRole("link", { name: "Open Staff" }).getAttribute("href")).toBe("/owner/staff");
  expect(screen.getByRole("link", { name: "Open Invitations" }).getAttribute("href")).toBe("/owner/staff/invitations");
});
it("offers direct personal actions without an unnecessary category step", async () => {
  grants.permissions = new Set(["settings.manage", "reports.operational", "dashboard.view"]);
  grants.features = new Set(["reports"]);
  render(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("link", { name: "Open Theme & artwork" }).getAttribute("href")).toBe("/owner/settings/appearance");
  expect(screen.getByRole("link", { name: "Open Report preferences" }).getAttribute("href")).toBe("/owner/settings/reports");
  expect(screen.queryByRole("link", { name: "Open Personal preferences settings" })).toBeNull();
  expect(screen.getByRole("link", { name: /Help: open guide/ })).toBeTruthy();
});
it("withholds report preferences without both grant and reports feature", async () => {
  grants.permissions = new Set(["settings.manage", "reports.operational"]);
  grants.features = new Set();
  render(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.queryByRole("link", { name: "Open Report preferences" })).toBeNull();
  expect(screen.getByRole("link", { name: "Open Theme & artwork" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Help: open guide/ })).toBeNull();
});
it("hides administration destinations whose initial reads need members.read", async () => {
  grants.permissions = new Set(["settings.manage", "settings.read"]);
  render(await SettingsPage({ searchParams: Promise.resolve({ category: "programs" }) }));
  expect(screen.queryByRole("link", { name: "Open Sports resources" })).toBeNull();
  cleanup();
  render(await SettingsPage({ searchParams: Promise.resolve({ category: "fees" }) }));
  expect(screen.queryByRole("link", { name: "Open Membership plans" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Open Café menu" })).toBeNull();
  expect(screen.getByRole("link", { name: "Open Payment QR codes" })).toBeTruthy();
});
