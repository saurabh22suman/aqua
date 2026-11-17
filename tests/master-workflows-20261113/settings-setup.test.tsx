// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const checklist = vi.hoisted(() => ({complete:true, dashboard:true}));
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner: async () => ({tenantId:"tenant-a",userId:"owner-a",features:new Set(),permissions:new Set(["settings.manage", "settings.read", ...(checklist.dashboard ? ["dashboard.view"] : [])])}),requirePagePermission:vi.fn()}));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({requireLiveOwnerSettingsPage:vi.fn()}));
vi.mock("@/lib/services/branding", () => ({getBranding:async () => ({displayName:null,fallbackDisplayName:"Synthetic club"})}));
vi.mock("@/lib/services/staff", () => ({getCurrentStaffIdentity:async () => null}));
vi.mock("@/lib/actions/locations", () => ({listAdminLocationsAction:async () => []}));
vi.mock("@/lib/actions/onboarding-checklist", () => ({getOnboardingChecklistAction:async () => ({items:[{key:"add_members",complete:true},{key:"create_batch",complete:checklist.complete},{key:"assign_coach",complete:true}],totalCount:3,scopeIsLimited:false})}));
vi.mock("@/components/tenant-sign-out", () => ({TenantSignOut: () => null}));
import SettingsPage from "@/app/(owner)/owner/settings/page";
import { SetupDisclosure } from "@/components/settings/setup-disclosure";
afterEach(() => {cleanup();localStorage.clear();checklist.complete = true;checklist.dashboard = true;});
it("offers optional help without a setup panel once setup is complete", async () => {
  render(await SettingsPage({searchParams:Promise.resolve({})}));
  expect(screen.queryByText("Club setup")).toBeNull();
  expect(screen.queryByTestId("settings-onboarding")).toBeNull();
  expect(screen.getByRole("link", {name:"Help: open guide"}).getAttribute("href")).toBe("/owner#workspace-guide");
});
it("does not carry one account's dismissal into another account", async () => {
  const first = render(<SetupDisclosure complete={false} namespace="tenant-a:user-a">Help</SetupDisclosure>);
  fireEvent.click(screen.getByText("Club setup"));
  first.unmount();
  render(<SetupDisclosure complete={false} namespace="tenant-b:user-b">Help</SetupDisclosure>);
  expect(screen.getByText("Club setup").closest("details")?.hasAttribute("open")).toBe(true);
});
it("offers the incomplete checklist while preserving settings destinations", async () => {
  checklist.complete = false;
  render(await SettingsPage({}));
  expect(screen.getByTestId("settings-onboarding").getAttribute("href")).toBe("/owner/onboarding");
  expect(screen.getByRole("link", {name:"Help: open guide"})).toBeTruthy();
  const hrefs = Array.from(document.querySelectorAll("a")).map(link => link.getAttribute("href"));
  expect(hrefs).toContain("/owner/settings?category=fees");
  expect(hrefs).toContain("/owner/settings?category=academy");
  cleanup();
  render(await SettingsPage({searchParams:Promise.resolve({category:"fees"})}));
  expect(screen.getByRole("link",{name:"Open Booking prices"}).getAttribute("href")).toBe("/owner/settings/booking-prices");
  cleanup();
  render(await SettingsPage({searchParams:Promise.resolve({category:"academy"})}));
  expect(screen.getByRole("link",{name:"Open Holidays & closures"}).getAttribute("href")).toBe("/owner/settings/holidays");
  expect(screen.getByRole("link",{name:"Open Business branding"}).getAttribute("href")).toBe("/owner/settings/branding");
});
it("does not offer home guide help without dashboard access", async () => {
  checklist.complete = false;
  checklist.dashboard = false;
  render(await SettingsPage({searchParams:Promise.resolve({})}));
  expect(screen.getByTestId("settings-onboarding").getAttribute("href")).toBe("/owner/onboarding");
  expect(screen.queryByRole("link", {name:"Help: open guide"})).toBeNull();
});
