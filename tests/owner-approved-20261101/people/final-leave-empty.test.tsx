// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ requests: [] as object[] }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}), requirePagePermission: vi.fn() }));
vi.mock("@/lib/actions/leave", () => ({ listLeaveTypesAction: async () => [], listLeaveRequestsAction: async () => state.requests }));
vi.mock("@/components/leave-types-editor", () => ({ LeaveTypesEditor: () => null }));
vi.mock("@/components/leave-decision-controls", () => ({ LeaveDecisionControls: () => null }));
import StaffLeavePage from "@/app/(owner)/owner/staff/leave/page";
afterEach(() => { cleanup(); state.requests = []; });
it.each([false, true])("shows one accurate pending-empty statement with decided history=%s", async (history) => {
  if (history) state.requests = [{ id: "1", status: "approved", staffName: "Aanya", leaveTypeName: "Casual", days: 1, fromDate: "2026-10-01", toDate: "2026-10-01" }];
  render(await StaffLeavePage());
  const section = screen.getByRole("heading", { name: "Pending approval" }).closest("section")!;
  expect(within(section).getByText("No leave request is waiting for a decision.")).toBeTruthy();
  expect(within(section).queryByText("No leave requests yet.")).toBeNull();
  if (history) expect(screen.getByText("Aanya")).toBeTruthy();
});
