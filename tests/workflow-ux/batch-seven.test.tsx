// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemberDetailTabs } from "@/components/member-detail/member-detail-tabs";
import { MemberEditForm } from "@/components/member-edit-form";
import CoachTodayPage from "@/app/(coach)/coach/page";
import ReceptionTodayPage from "@/app/(reception)/reception/page";
import MemberAccessPage from "@/app/(owner)/owner/members/[memberId]/access/page";
import type { MemberDetail } from "@/lib/services/people";

const memberId = "01a1f86c-a437-763d-bd68-07f582e3e1c9";
const readers = vi.hoisted(() => ({ coach: vi.fn(), today: vi.fn(), update: vi.fn(), access: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/owner/members/member",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/actions/people", () => ({ updateMemberAction: readers.update }));
vi.mock("@/lib/actions/member-link-binding", () => ({ enrollMemberSignInAction: vi.fn() }));
vi.mock("@/lib/services/member-link-readmodel", () => ({ readMemberAccessLinks: readers.access }));
vi.mock("@/components/member-detail/member-access-panel", () => ({ MemberAccessPanel: () => <h2>Sign-in links</h2> }));
vi.mock("@/lib/actions/coach", () => ({
  getCoachHomeAction: readers.coach,
  getTodayAction: readers.today,
  getRosterAction: vi.fn(),
  markAttendanceSessionAction: vi.fn(),
}));
vi.mock("@/lib/actions/staff-attendance", () => ({ listStaffAttendanceDayAction: vi.fn() }));
vi.mock("@/components/staff-attendance-board", () => ({ StaffAttendanceBoard: () => null }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({ tenantId: "club", userId: "owner", roleKey: "owner" }),
  requirePagePermission: vi.fn(),
  requireCoach: async () => ({ tenantId: "club", userId: "coach", roleKey: "coach" }),
  requireReception: async () => ({ tenantId: "club", userId: "reception", roleKey: "receptionist" }),
}));
vi.mock("@/lib/auth/permission", () => ({
  hasFeature: (_ctx: unknown, key: string) => key === "billing",
  hasPermission: (_ctx: unknown, key: string) => ["members.write", "payments.record", "invoices.read"].includes(key),
}));

const member: MemberDetail = {
  memberId, personId: memberId, fullName: "Anika Joshi", phone: null,
  dateOfBirth: "2015-01-01", gender: null, medicalNotes: null, memberCode: "AUD-01",
  status: "active", locationId: "north", locationName: "North", isMinor: true,
  joinedOn: "2025-01-10", createdAt: "2025-01-10T01:00:00Z", guardians: [], consents: [], statusHistory: [],
};

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("keeps the authorized member access link visible beside scoped member sections", () => {
  const href = `/owner/members/${memberId}/access?facility=all`;
  render(<MemberDetailTabs memberId={memberId} active="overview" facilityScope="all" accessHref={href} />);
  const nav = screen.getByRole("navigation", { name: "Member sections" });
  const entry = within(nav).getByRole("link", { name: "Member and family access" });
  expect(entry.closest("details")).toBeNull();
  expect(entry.getAttribute("href")).toBe(href);
});

it("identifies pending edit fields without putting their values in the save summary", () => {
  render(<MemberEditForm member={member} locations={[{ id: "north", name: "North" }]} />);
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Anika J." } });
  fireEvent.change(screen.getByLabelText("Medical notes (optional)"), { target: { value: "Draft note" } });
  const changes = screen.getByRole("region", { name: "Changes to save" });
  expect(within(changes).getByText("2 fields changed")).toBeTruthy();
  expect(changes.textContent).toContain("Full name");
  expect(changes.textContent).toContain("Medical notes");
  expect(changes.textContent).not.toContain("Draft note");
  expect(readers.update).not.toHaveBeenCalled();
});

it("shows the member's identity on the access page and opens setup on request", async () => {
  readers.access.mockResolvedValue({ memberId, memberName: member.fullName, memberCode: member.memberCode, facilityName: member.locationName, links: [] });
  render(await MemberAccessPage({ params: Promise.resolve({ memberId }), searchParams: Promise.resolve({ facility: "all" }) }));
  expect(screen.getByRole("region", { name: "Member identity" }).textContent).toContain(member.memberCode);
  const disclosure = screen.getByText("Set up a new sign-in", { exact: true }).closest("details");
  expect(disclosure?.open).toBe(false);
  fireEvent.click(within(disclosure!).getByText("Set up a new sign-in"));
  expect(within(disclosure!).getByLabelText("Sign-in phone number")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Sign-in links" })).toBeTruthy();
});

it("offers a schedule and a real retry when today's Coach register read fails", async () => {
  readers.coach.mockRejectedValue(new Error("disconnected"));
  render(await CoachTodayPage());
  const status = screen.getByRole("region", { name: "Registers unavailable" });
  expect(within(status).getByRole("link", { name: "Retry today's registers" }).getAttribute("href")).toBe("/coach");
  expect(within(status).getByRole("link", { name: "Open schedule" }).getAttribute("href")).toBe("/coach/schedule");
  expect(screen.queryByText("No sessions scheduled")).toBeNull();
});

it("keeps Reception lookup and payment available when the check-in read fails", async () => {
  readers.today.mockRejectedValue(new Error("disconnected"));
  render(await ReceptionTodayPage());
  const shortcuts = screen.getByRole("navigation", { name: "Counter shortcuts" });
  expect(within(shortcuts).getByRole("link", { name: "Collect payment" }).getAttribute("href")).toBe("/reception/collect-payment");
  expect(within(shortcuts).getByRole("link", { name: "Find a member" }).getAttribute("href")).toBe("/reception/members");
  expect(screen.getByRole("link", { name: "Retry today's check-ins" }).getAttribute("href")).toBe("/reception");
  expect(screen.queryByText("No sessions today")).toBeNull();
});
