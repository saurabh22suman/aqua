// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({role:"owner",tenantId:"11111111-1111-4111-8111-111111111111"}));
const ctx = () => ({tenantId:state.tenantId,userId:"user",roleKey:state.role,permissions:new Set(["settings.manage","staff.self","members.read"]),features:new Set<string>()});
vi.mock("@/lib/auth/context", () => ({requireDefaultCtx:async () => ctx()}));
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner:async () => ctx(),requireCoach:async () => ctx(),requireReception:async () => ctx(),requirePagePermission:vi.fn()}));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({requireLiveOwnerSettingsPage:vi.fn()}));
vi.mock("@/lib/services/staff", () => ({getCurrentStaffIdentity:async () => null}));
vi.mock("@/lib/actions/shifts", () => ({listMyShiftsAction:async () => []}));
vi.mock("@/lib/actions/staff-attendance", () => ({getMyAttendanceAction:async () => null}));
vi.mock("@/lib/actions/leave", () => ({listLeaveTypesAction:async () => [],listMyLeaveAction:async () => ({balances:[],requests:[]})}));
vi.mock("@/lib/actions/locations", () => ({listAdminLocationsAction:async () => []}));
vi.mock("@/lib/actions/onboarding-checklist", () => ({getOnboardingChecklistAction:async () => null}));
vi.mock("@/components/my-shifts-card", () => ({MyShiftsCard:() => null}));
vi.mock("@/components/my-attendance-card", () => ({MyAttendanceCard:() => null}));
vi.mock("@/components/my-leave-card", () => ({MyLeaveCard:() => null}));
vi.mock("@/components/tenant-sign-out", () => ({TenantSignOut:() => null}));
import OwnerSettings from "@/app/(owner)/owner/settings/page";
import CoachMe from "@/app/(coach)/coach/me/page";
import ReceptionMe from "@/app/(reception)/reception/me/page";
import WorkerHome from "@/app/(worker)/worker/page";
afterEach(cleanup);
it.each([['owner',() => OwnerSettings({})],['coach',CoachMe],['receptionist',ReceptionMe],['worker',WorkerHome]] as const)("offers the current club install from the %s account area", async (role, page) => {
  state.role = role;
  render(await page());
  expect(screen.getByRole("link",{name:/install this club/i}).getAttribute("href")).toBe(`/clubs/${state.tenantId}/install?source=staff`);
});
