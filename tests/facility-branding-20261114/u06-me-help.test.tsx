import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "coach" }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ({ tenantId: "test", roleKey: state.role, permissions: new Set() }) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireCoach: async () => {}, requireReception: async () => {} }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: () => false, requirePermission: () => {} }));
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: async () => null }));
vi.mock("@/lib/actions/shifts", () => ({ listMyShiftsAction: async () => [] }));
vi.mock("@/lib/actions/staff-attendance", () => ({ getMyAttendanceAction: async () => null }));
vi.mock("@/lib/actions/leave", () => ({ listLeaveTypesAction: async () => [], listMyLeaveAction: async () => ({ balances: [], requests: [] }) }));
vi.mock("@/components/my-shifts-card", () => ({ MyShiftsCard: () => null }));
vi.mock("@/components/my-attendance-card", () => ({ MyAttendanceCard: () => null }));
vi.mock("@/components/my-leave-card", () => ({ MyLeaveCard: () => null }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
vi.mock("@/components/staff-club-install-link", () => ({ StaffClubInstallLink: () => null }));
vi.mock("@/components/staff-ui/staff-appearance", () => ({ StaffAppearance: () => null }));
vi.mock("@/components/announcements/staff-inbox-link", () => ({ StaffInboxLink: () => null }));
import CoachMePage from "@/app/(coach)/coach/me/page";
import ReceptionMePage from "@/app/(reception)/reception/me/page";

it.each([["coach", "/coach", CoachMePage], ["receptionist", "/reception", ReceptionMePage]] as const)("offers %s recovery exactly once only for its matching role", async (role, home, Page) => {
  state.role = role;
  const html = renderToStaticMarkup(await Page());
  expect(html.match(/Help: open guide/g)).toHaveLength(1);
  expect(html).toContain(`href="${home}#workspace-guide"`);
  state.role = "worker";
  expect(renderToStaticMarkup(await Page())).not.toContain("#workspace-guide");
});
