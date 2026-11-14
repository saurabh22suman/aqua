// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ roleKey: "coach", reads: vi.fn(), ownerGuard: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ({ roleKey: state.roleKey, tenantId: "tenant-a", userId: "user-a", permissions: new Set(["staff.self"]) }) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireCoach: async () => ({}), requireReception: async () => ({}), requireOwner: state.ownerGuard }));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: () => {}, hasPermission: (_ctx: unknown, permission: string) => permission === "staff.self" }));
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: async () => null }));
vi.mock("@/lib/actions/shifts", () => ({ listMyShiftsAction: async () => [] }));
vi.mock("@/lib/actions/staff-attendance", () => ({ getMyAttendanceAction: async () => null }));
vi.mock("@/lib/actions/leave", () => ({ listLeaveTypesAction: async () => [], listMyLeaveAction: async () => ({ balances: [], requests: [] }) }));
vi.mock("@/components/my-shifts-card", () => ({ MyShiftsCard: () => null }));
vi.mock("@/components/my-attendance-card", () => ({ MyAttendanceCard: () => null }));
vi.mock("@/components/my-leave-card", () => ({ MyLeaveCard: () => null }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
vi.mock("@/components/staff-ui/staff-appearance", () => ({ StaffAppearance: () => null }));
vi.mock("@/components/onboarding/optional-workspace-guide", () => ({ OptionalWorkspaceGuide: () => null }));
vi.mock("@/lib/services/announcements", () => ({ listMyNotifications: state.reads }));
vi.mock("@/components/announcements/notification-inbox", () => ({ NotificationInbox: () => <p>Personal notifications</p> }));

import CoachMePage from "@/app/(coach)/coach/me/page";
import ReceptionMePage from "@/app/(reception)/reception/me/page";
import WorkerHomePage from "@/app/(worker)/worker/page";
import OwnerInboxPage from "@/app/(owner)/owner/inbox/page";

afterEach(() => { cleanup(); state.reads.mockReset(); state.ownerGuard.mockReset(); });

describe("staff announcement entry points", () => {
  it.each([
    ["coach", CoachMePage, "/coach/announcements"],
    ["receptionist", ReceptionMePage, "/reception/announcements"],
    ["worker", WorkerHomePage, "/worker/announcements"],
  ] as const)("offers %s a reachable announcement link", async (role, page, href) => {
    state.roleKey = role;
    render(await page());
    expect(screen.getByRole("link", { name: /announcements/i }).getAttribute("href")).toBe(href);
  });
});

describe("owner-surface personal inbox boundary", () => {
  it.each(["manager", "accountant"])("reads only the current %s recipient without composer", async (role) => {
    state.roleKey = role;
    state.reads.mockResolvedValue([]);
    render(await OwnerInboxPage());
    expect(state.ownerGuard).toHaveBeenCalledOnce();
    expect(state.reads).toHaveBeenCalledWith(expect.objectContaining({ roleKey: role, tenantId: "tenant-a", userId: "user-a" }));
    expect(screen.getByText("Personal notifications")).toBeTruthy();
    expect(screen.queryByText(/sent history|compose/i)).toBeNull();
  });
  it("denies a coach before reading owner-surface notifications", async () => {
    state.roleKey = "coach";
    await expect(OwnerInboxPage()).rejects.toThrow("NOT_FOUND");
    expect(state.reads).not.toHaveBeenCalled();
  });
});
