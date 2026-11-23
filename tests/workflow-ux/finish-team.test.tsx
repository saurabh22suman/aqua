// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Finish lane "team" — Owner staff routes.
// Every assertion below is a workflow outcome (find a person, decide leave,
// know what is unmarked, issue access), not a class-name check.

const mocks = vi.hoisted(() => ({
  permissions: new Set([
    "staff.read",
    "staff.write",
    "staff.invite",
    "staff.roster",
    "staff.attendance",
    "settings.manage",
  ]),
  features: new Set(["staff"]),
  listStaff: vi.fn(),
  listAttendance: vi.fn(),
  listInvitations: vi.fn(),
  invite: vi.fn(),
  leaveRequests: vi.fn(),
  leaveTypes: vi.fn(),
  rosterWeek: vi.fn(),
  templates: vi.fn(),
  locations: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "club",
    userId: "owner-user",
    membershipId: "owner-membership",
    roleKey: "owner",
  }),
  requirePagePermission: vi.fn(),
}));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({
  isLiveOwnerForSettings: async () => true,
  requireLiveOwnerSettingsPage: async () => {},
}));
vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (_ctx: unknown, key: string) => mocks.permissions.has(key),
  hasFeature: (_ctx: unknown, key: string) => mocks.features.has(key),
}));
vi.mock("@/db/tenant", () => ({
  withTenant: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock("@/lib/services/tenant-timezone", () => ({
  tenantTimezoneInTx: async () => "Asia/Kolkata",
}));
vi.mock("@/lib/services/staff-self", () => ({
  ownStaffIdInTx: async () => "staff-self",
}));
vi.mock("@/lib/services/owner-authority", () => ({
  callerIsLiveOwnerForSettingsOrDelegation: async () => true,
}));
vi.mock("@/lib/services/curriculum-lead", () => ({
  getCurriculumLeadState: async () => null,
}));
vi.mock("@/lib/actions/curriculum-lead", () => ({
  setStaffCurriculumLeadAction: vi.fn(),
}));
vi.mock("@/lib/services/premises-qr", () => ({
  signPremisesQrToken: () => ({ token: "signed-token" }),
}));
vi.mock("@/components/link-qr", () => ({ LinkQr: () => null }));
vi.mock("@/components/shift-template-editor", () => ({
  ShiftTemplateEditor: () => null,
}));

vi.mock("@/lib/actions/staff", () => ({
  listStaffAction: mocks.listStaff,
  createStaffAction: vi.fn(),
  searchStaffCandidatesAction: vi.fn(),
}));
vi.mock("@/lib/actions/staff-attendance", () => ({
  listStaffAttendanceDayAction: mocks.listAttendance,
  correctStaffAttendanceAction: vi.fn(),
}));
vi.mock("@/lib/actions/staff-invitations", () => ({
  listInvitationsAction: mocks.listInvitations,
  inviteStaffAction: mocks.invite,
  revokeInvitationAction: vi.fn(),
  reactivateInvitationAction: vi.fn(),
}));
vi.mock("@/lib/actions/invite-link", () => ({
  issueLoginLinkAction: vi.fn(),
}));
vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: mocks.locations,
}));
vi.mock("@/lib/actions/leave", () => ({
  listLeaveRequestsAction: mocks.leaveRequests,
  listLeaveTypesAction: mocks.leaveTypes,
  createLeaveTypeAction: vi.fn(),
  updateLeaveTypeAction: vi.fn(),
  approveLeaveRequestAction: vi.fn(),
  rejectLeaveRequestAction: vi.fn(),
  listUncoveredSessionsAction: vi.fn(),
}));
vi.mock("@/lib/actions/shifts", () => ({
  listRosterWeekAction: mocks.rosterWeek,
  listShiftTemplatesAction: mocks.templates,
  createShiftAction: vi.fn(),
  deleteShiftAction: vi.fn(),
  publishRosterAction: vi.fn(),
}));
vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));

import { StaffBoard } from "@/components/staff-board";
import { StaffInviteForm } from "@/components/staff-invite-form";
import { StaffCreateForm } from "@/components/staff-create-form";
import StaffDetailPage from "@/app/(owner)/owner/staff/[staffId]/page";
import StaffAttendancePage from "@/app/(owner)/owner/staff/attendance/page";
import StaffCheckInQrPage from "@/app/(owner)/owner/staff/check-in-qr/page";
import StaffInvitationsPage from "@/app/(owner)/owner/staff/invitations/page";
import StaffLeavePage from "@/app/(owner)/owner/staff/leave/page";
import StaffRosterPage from "@/app/(owner)/owner/staff/roster/page";
import { addDays, todayInZone, weekdayOf } from "@/lib/time/tz";
import type { StaffRow } from "@/lib/services/staff";
import type { StaffAttendanceDayRow } from "@/lib/services/staff-attendance";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";
import type { LeaveRequestRow } from "@/lib/services/leave-approval";

const staffRows = [
  {
    id: "staff-asha",
    personId: "person-asha",
    fullName: "Asha Rao",
    userId: null,
    staffType: "coach",
    employedOn: "2025-06-02",
  },
  {
    id: "staff-vikram",
    personId: "person-vikram",
    fullName: "Vikram Nair",
    userId: "user-vikram",
    staffType: "receptionist",
    employedOn: null,
  },
] as unknown as StaffRow[];

const attendanceRows: StaffAttendanceDayRow[] = [
  {
    staffId: "staff-asha",
    staffName: "Asha Rao",
    staffType: "coach",
    shiftStartAt: "2026-11-20T00:30:00.000Z",
    shiftEndAt: "2026-11-20T04:30:00.000Z",
    status: "present",
    lateMinutes: 12,
    method: "self_qr",
    checkedInAt: "2026-11-20T00:42:00.000Z",
    checkedOutAt: null,
    note: null,
  },
  {
    staffId: "staff-vikram",
    staffName: "Vikram Nair",
    staffType: "receptionist",
    shiftStartAt: null,
    shiftEndAt: null,
    status: "absent",
    lateMinutes: 0,
    method: "manual",
    checkedInAt: null,
    checkedOutAt: null,
    note: "No show",
  },
  {
    staffId: "staff-ria",
    staffName: "Ria Shah",
    staffType: "worker",
    shiftStartAt: null,
    shiftEndAt: null,
    status: null,
    lateMinutes: 0,
    method: null,
    checkedInAt: null,
    checkedOutAt: null,
    note: null,
  },
];

function invitation(
  membershipId: string,
  fullName: string,
  status: ListInvitationsRow["status"],
): ListInvitationsRow {
  return {
    membershipId,
    fullName,
    phone: "+919000000001",
    status,
    roleKey: "coach",
    locationNames: ["Worli"],
    allLocations: false,
    invitedAt: null,
  } as unknown as ListInvitationsRow;
}

function leaveRequest(
  id: string,
  staffName: string,
  status: string,
): LeaveRequestRow {
  return {
    id,
    staffId: `staff-${id}`,
    staffName,
    leaveTypeId: "type-casual",
    leaveTypeName: "Casual",
    fromDate: "2026-11-24",
    toDate: "2026-11-24",
    days: 1,
    reason: "Family function",
    status,
    decidedAt: status === "pending" ? null : "2026-11-18T04:00:00.000Z",
    decisionNote: null,
  };
}

beforeEach(() => {
  mocks.listStaff.mockResolvedValue(staffRows);
  mocks.listAttendance.mockResolvedValue(attendanceRows);
  mocks.listInvitations.mockResolvedValue([
    invitation("membership-asha", "Asha Rao", "invited"),
    invitation("membership-vikram", "Vikram Nair", "active"),
    invitation("membership-ria", "Ria Shah", "revoked"),
  ]);
  mocks.locations.mockResolvedValue([]);
  mocks.leaveTypes.mockResolvedValue([
    { id: "type-casual", name: "Casual", annualQuota: 12, isPaid: true },
  ]);
  mocks.leaveRequests.mockImplementation(async (input?: { status?: string }) =>
    input?.status === "pending"
      ? [leaveRequest("pending-1", "Asha Rao", "pending")]
      : [
          leaveRequest("pending-1", "Asha Rao", "pending"),
          leaveRequest("approved-1", "Vikram Nair", "approved"),
        ],
  );
  mocks.templates.mockResolvedValue([]);
  mocks.rosterWeek.mockResolvedValue([]);
  mocks.permissions = new Set([
    "staff.read",
    "staff.write",
    "staff.invite",
    "staff.roster",
    "staff.attendance",
    "settings.manage",
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("finds a person in a long staff directory and states the missing-login next step", () => {
  render(<StaffBoard rows={staffRows} />);
  const search = screen.getByRole("searchbox", { name: "Find a staff member" });
  expect(screen.getByText("2 staff · 1 without login access")).toBeTruthy();

  fireEvent.change(search, { target: { value: "vikram" } });
  expect(screen.getByText("1 of 2 staff")).toBeTruthy();
  expect(screen.queryByText("Asha Rao")).toBeNull();
  expect(screen.getAllByText("Vikram Nair").length).toBeGreaterThan(0);

  fireEvent.change(search, { target: { value: "nobody" } });
  expect(screen.getByText(/No staff match/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear staff search" }));
  expect(screen.getAllByText("Asha Rao").length).toBeGreaterThan(0);
  expect(screen.getByText("2 staff · 1 without login access")).toBeTruthy();
});

it("turns a staff record's login state into the right next action", async () => {
  const unlinked = staffRows[0];
  render(
    await StaffDetailPage({
      params: Promise.resolve({ staffId: unlinked.id }),
    }),
  );
  expect(screen.getByRole("heading", { level: 1, name: "Asha Rao" })).toBeTruthy();
  expect(screen.getByText("Not linked")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Invite Asha Rao to sign in" })
      .getAttribute("href"),
  ).toBe("/owner/staff/invitations/new");

  cleanup();
  const linked = staffRows[1];
  render(
    await StaffDetailPage({
      params: Promise.resolve({ staffId: linked.id }),
    }),
  );
  expect(screen.getByText("Linked")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Manage login access" })
      .getAttribute("href"),
  ).toBe("/owner/staff/invitations");
});

it("moves between attendance days without losing context and says what is unmarked", async () => {
  render(
    await StaffAttendancePage({
      searchParams: Promise.resolve({ date: "2026-11-20" }),
    }),
  );
  expect(screen.getByText("Fri, 20 Nov 2026")).toBeTruthy();
  expect(screen.getByText("2 of 3 marked · 1 not marked · 1 late")).toBeTruthy();

  const dayNav = screen.getByRole("navigation", { name: "Attendance date" });
  expect(
    within(dayNav).getByRole("link", { name: "Previous day" }).getAttribute("href"),
  ).toBe("/owner/staff/attendance?date=2026-11-19");
  expect(
    within(dayNav).getByRole("link", { name: "Next day" }).getAttribute("href"),
  ).toBe("/owner/staff/attendance?date=2026-11-21");
});

it("tells the owner what staff need and where the mark lands after printing the QR", async () => {
  render(await StaffCheckInQrPage());
  const steps = screen.getByRole("region", { name: "Before you print" });
  expect(within(steps).getByText(/issued for this academy only/i)).toBeTruthy();
  expect(
    within(steps)
      .getByRole("link", { name: "Open staff attendance" })
      .getAttribute("href"),
  ).toBe("/owner/staff/attendance");
  expect(
    within(steps)
      .getByRole("link", { name: "Invite staff to sign in" })
      .getAttribute("href"),
  ).toBe("/owner/staff/invitations/new");
});

it("filters invitations by state from the URL and finds a person in the list", async () => {
  render(
    await StaffInvitationsPage({
      searchParams: Promise.resolve({ state: "invited" }),
    }),
  );
  expect(screen.queryByRole("navigation", { name: "Invitation state" })).toBeNull();
  const trigger = screen.getByRole("button", { name: "Invitation filters" });
  expect(trigger.textContent).toContain("Invited");
  fireEvent.click(trigger);
  const sheet = within(screen.getByRole("dialog", { name: "Invitation filters" }));
  const filters = sheet.getByRole("navigation", { name: "Invitation state" });
  expect(sheet.getByRole("combobox", { name: "Sort invitations" })).toBeTruthy();
  expect(within(filters).getByRole("link", { name: /Invited/ }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByText("Asha Rao")).toBeTruthy();
  expect(screen.queryByText("Vikram Nair")).toBeNull();
  expect(screen.queryByText("Ria Shah")).toBeNull();

  cleanup();
  render(
    await StaffInvitationsPage({ searchParams: Promise.resolve({}) }),
  );
  fireEvent.change(screen.getByRole("searchbox", { name: "Find an invitation" }), {
    target: { value: "ria" },
  });
  expect(screen.getByText("Ria Shah")).toBeTruthy();
  expect(screen.queryByText("Asha Rao")).toBeNull();
});

it("keeps a filtered invitation list honest when nothing matches the chosen state", async () => {
  mocks.listInvitations.mockResolvedValue([invitation("membership-asha", "Asha Rao", "invited")]);
  render(
    await StaffInvitationsPage({
      searchParams: Promise.resolve({ state: "revoked" }),
    }),
  );
  expect(screen.getByText("No revoked invitations")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Show all invitations" }).getAttribute("href"),
  ).toBe("/owner/staff/invitations");
});

it("offers Manager in place of Accountant on new invitations", () => {
  render(<StaffInviteForm locations={[]} />);
  expect(screen.getByRole("button", { name: "Manager" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Accountant" })).toBeNull();
});

it("keeps an invitation scoped and takes the owner to the missing phone field", async () => {
  mocks.invite.mockResolvedValue({ kind: "error", message: "Invitation refused." });
  render(
    <StaffInviteForm
      locations={[
        { id: "site-a", name: "Site A" },
        { id: "site-b", name: "Site B" },
      ]}
    />,
  );
  fireEvent.change(screen.getByTestId("invite-name"), {
    target: { value: "Asha Rao" },
  });
  fireEvent.click(
    screen.getByRole("radio", {
      name: /whole academy, including future facilities/i,
    }),
  );
  fireEvent.click(screen.getByTestId("invite-save"));

  expect(mocks.invite).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/phone number/i);
  expect(document.activeElement).toBe(screen.getByTestId("invite-phone"));

  fireEvent.change(screen.getByTestId("invite-phone"), {
    target: { value: "+919876543210" },
  });
  fireEvent.click(screen.getByTestId("invite-save"));
  await waitFor(() => expect(mocks.invite).toHaveBeenCalledTimes(1));
  expect(mocks.invite).toHaveBeenCalledWith(
    expect.objectContaining({
      phone: "+919876543210",
      fullName: "Asha Rao",
      roleKey: "coach",
      locationIds: [],
      managerAllLocations: false,
    }),
  );
});

it("explains why a staff record cannot be added yet instead of only disabling the action", () => {
  render(
    <StaffCreateForm terminology={{ locale: "en", overrides: {} }} />,
  );
  expect(screen.getByRole("status").textContent).toMatch(
    /full name to continue/i,
  );
  fireEvent.change(screen.getByTestId("staff-fullName"), {
    target: { value: "Asha Rao" },
  });
  expect(screen.queryByRole("status")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Existing person" }));
  expect(screen.getByRole("status").textContent).toMatch(
    /choose an existing person/i,
  );
});

it("counts the leave queue and keeps it readable when leave types cannot load", async () => {
  mocks.leaveTypes.mockRejectedValue(new Error("read failed"));
  render(await StaffLeavePage());
  const nav = screen.getByRole("navigation", { name: "Leave sections" });
  expect(
    within(nav).getByRole("link", { name: "Pending approval (1)" }).getAttribute("href"),
  ).toBe("#leave-pending");
  expect(
    within(nav).getByRole("link", { name: "Previous decisions (1)" }).getAttribute("href"),
  ).toBe("#leave-history");
  expect(
    within(nav).getByRole("link", { name: "Leave types" }).getAttribute("href"),
  ).toBe("#leave-types");
  expect(screen.getByText("Asha Rao")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toMatch(/leave types/i);
});

it("states the roster week range and how much is still unpublished", async () => {
  mocks.listStaff.mockResolvedValue([staffRows[0]]);
  mocks.rosterWeek.mockResolvedValue([
    {
      id: "shift-draft",
      staffId: staffRows[0].id,
      staffName: "Asha Rao",
      shiftDate: "2026-11-16",
      startAt: "2026-11-16T00:30:00.000Z",
      endAt: "2026-11-16T04:30:00.000Z",
      status: "rostered",
      publishedAt: null,
    },
    {
      id: "shift-published",
      staffId: staffRows[0].id,
      staffName: "Asha Rao",
      shiftDate: "2026-11-17",
      startAt: "2026-11-17T00:30:00.000Z",
      endAt: "2026-11-17T04:30:00.000Z",
      status: "rostered",
      publishedAt: "2026-11-15T04:30:00.000Z",
    },
  ]);
  const today = todayInZone("Asia/Kolkata");
  const dow = weekdayOf(today);
  const monday = addDays(today, -(dow === 0 ? 6 : dow - 1));

  render(
    await StaffRosterPage({ searchParams: Promise.resolve({ week: monday }) }),
  );
  const nav = screen.getByRole("navigation", { name: "Roster week and facility" });
  fireEvent.click(within(nav).getByRole("button", { name: "Roster week and facility" }));
  expect(
    within(screen.getByRole("dialog", { name: "Roster week and facility" }))
      .getByRole("link", { name: "This week" }).getAttribute("aria-current"),
  ).toBe("page");
  expect(within(nav).getByRole("button", { name: "Roster week and facility" }).textContent).toMatch(/Mon, \d+ \w+ – Sun, \d+ \w+/);
  const summary = screen.getByText(/1 draft shift to publish/);
  expect(summary.textContent).toMatch(/1 draft shift to publish/);
});
