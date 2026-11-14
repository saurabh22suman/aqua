// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const checklist = vi.hoisted(() => ({complete:true}));
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner: async () => ({tenantId:"tenant-a",userId:"owner-a",features:new Set(),permissions:new Set(["settings.manage"])}),requirePagePermission:vi.fn()}));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({requireLiveOwnerSettingsPage:vi.fn()}));
vi.mock("@/lib/services/staff", () => ({getCurrentStaffIdentity:async () => null}));
vi.mock("@/lib/actions/locations", () => ({listAdminLocationsAction:async () => []}));
vi.mock("@/lib/actions/onboarding-checklist", () => ({getOnboardingChecklistAction:async () => ({items:[{key:"add_members",complete:true},{key:"create_batch",complete:checklist.complete},{key:"assign_coach",complete:true}],totalCount:3,scopeIsLimited:false})}));
vi.mock("@/components/tenant-sign-out", () => ({TenantSignOut: () => null}));
import SettingsPage from "@/app/(owner)/owner/settings/page";
import { SetupDisclosure } from "@/components/settings/setup-disclosure";
afterEach(() => {cleanup();localStorage.clear();checklist.complete = true;});
it("keeps completed setup available in a compact closed disclosure", async () => {
  render(await SettingsPage({searchParams:Promise.resolve({})}));
  const summary = screen.getByText("Club setup");
  const disclosure = summary.closest("details");
  expect(disclosure).toBeTruthy();
  expect(disclosure?.hasAttribute("open")).toBe(false);
  expect(screen.getByText(/Physical facilities/)).toBeTruthy();
});
it("does not carry one account's dismissal into another account", async () => {
  const {fireEvent} = await import("@testing-library/react");
  const first = render(<SetupDisclosure complete={false} namespace="tenant-a:user-a">Help</SetupDisclosure>);
  fireEvent.click(screen.getByText("Club setup"));
  first.unmount();
  render(<SetupDisclosure complete={false} namespace="tenant-b:user-b">Help</SetupDisclosure>);
  expect(screen.getByText("Club setup").closest("details")?.hasAttribute("open")).toBe(true);
});
it("opens incomplete setup on a first visit while preserving settings destinations", async () => {
  checklist.complete = false;
  render(await SettingsPage({}));
  expect(screen.getByText("Club setup").closest("details")?.hasAttribute("open")).toBe(true);
  const hrefs = Array.from(document.querySelectorAll("a")).map(link => link.getAttribute("href"));
  expect(hrefs).toContain("/owner/settings/booking-prices");
  expect(hrefs).toContain("/owner/settings/holidays");
  expect(hrefs).toContain("/owner/settings/branding");
});
it("remembers an explicit personal dismissal of incomplete setup on return", async () => {
  const {fireEvent} = await import("@testing-library/react");
  checklist.complete = false;
  const first = render(await SettingsPage({searchParams:Promise.resolve({})}));
  const summary = screen.getByText("Club setup");
  expect(summary.closest("details")?.hasAttribute("open")).toBe(true);
  fireEvent.click(summary);
  first.unmount();
  render(await SettingsPage({searchParams:Promise.resolve({})}));
  expect(screen.getByText("Club setup").closest("details")?.hasAttribute("open")).toBe(false);
  checklist.complete = true;
});
