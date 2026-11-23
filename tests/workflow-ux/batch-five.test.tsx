// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ScheduleMobileAgenda } from "@/components/owner-approved/operations/schedule-mobile-agenda";
import { sessionToCalendarEvent } from "@/components/owner-calendar/calendar-session-event";
import { UpcomingSessionsList } from "@/components/upcoming-sessions-list";
import { ReceptionCloseDay } from "@/components/reception-close-day";
import type { ReceptionCloseSummary } from "@/lib/services/reconciliation-closed-state";
import CoachMemberDetailPage from "@/app/(coach)/coach/members/[memberId]/page";
import FamilyShowcasePage from "@/app/(self)/family/showcase/[memberId]/page";

const memberId = "11111111-1111-4111-8111-111111111111";
const actions = vi.hoisted(() => ({ confirm: vi.fn(), read: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireCoach: async () => ({ permissions: new Set() }) }));
vi.mock("@/lib/auth/permission", () => ({ hasFeature: () => false, hasPermission: () => false }));
vi.mock("@/lib/actions/coach", () => ({ getCoachMemberDetailAction: async () => ({
  memberId, memberCode: "JRS-12", fullName: "Aarush Iyer", dateOfBirth: null, phone: null, medicalNotes: "Check shoulder", isMinor: true,
  guardians: [{ fullName: "Geeta Iyer", phone: "+91 98123 40017" }, { fullName: "Alternate guardian", phone: "unknown" }],
  batches: ["Junior TTS"], attendance: { today: "2026-11-21", pct: null, presentCount: 0, totalCount: 0, rows: [] },
}) }));
vi.mock("@/lib/actions/absence-alerts", () => ({ listMemberAlertsAction: async () => [] }));
vi.mock("@/lib/actions/assessments", () => ({ getMemberProgressAction: vi.fn() }));
vi.mock("@/lib/actions/reconciliation", () => ({ confirmCashCountAction: actions.confirm, getReceptionCloseSummaryAction: actions.read }));
vi.mock("@/lib/actions/coach-substitution", () => ({ substituteCoachAction: vi.fn() }));
vi.mock("@/lib/actions/session-lifecycle", () => ({ cancelSessionAction: vi.fn(), rescheduleSessionAction: vi.fn() }));
vi.mock("@/lib/auth/self-scope", () => ({ resolveScopedSelfScope: async () => ({ read: async (fn: () => unknown) => fn() }) }));
vi.mock("@/lib/services/showcase/state", () => ({ readShowcaseState: async () => ({ subjects: [{
  memberId, isMinor: true, state: "pending", publicPath: null, chosenName: null,
  reason: "Waiting for a guardian's approval.", allowedActions: ["approve", "revoke"],
}] }) }));
vi.mock("@/lib/services/self-home", () => ({ readSelfHome: async () => ({
  entries: [{ memberId, memberCode: "FAM-1", fullName: "Anika Joshi" }],
}) }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("shows the real count in each day link and offers the next populated day on a quiet day", () => {
  const emptyDay = "2026-11-16";
  const nextDay = "2026-11-17";
  const href = "/owner/schedule?view=week&date=2026-11-17&facility=north";
  const event = sessionToCalendarEvent({
    id: "s", sessionDate: nextDay, startsAt: nextDay+"T01:30:00Z", endsAt: nextDay+"T02:30:00Z",
    status: "scheduled", batchId: "b", batchName: "Beginners", capacity: 12, enrolled: 4, locationId: "north", locationName: "North", coachName: "Anita",
  }, null, "");
  render(<ScheduleMobileAgenda events={[event]} days={[emptyDay, nextDay]} selectedDate={emptyDay}
    dayHrefs={{ [emptyDay]: "#quiet", [nextDay]: href }} labels={{ batch: "Batch", booking: "Booking" }} view="week" />);
  const days = screen.getByRole("navigation", { name: "Choose a day" });
  expect(within(days).getByRole("link", { name: /Mon.*16.*0 sessions/i, current: "date" })).toBeTruthy();
  expect(within(days).getByRole("link", { name: /Tue.*17.*1 session/i })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Next day with sessions.*17/i }).getAttribute("href")).toBe(href);
});

it("opens the editor inside the chosen session and keeps focus on its toggle", () => {
  const row = {
    id: "s", sessionDate: "2030-01-07", startsAt: new Date("2030-01-07T01:30:00Z"), endsAt: new Date("2030-01-07T02:30:00Z"),
    batchName: "Beginners", status: "scheduled", coachId: null, coachName: null, locationName: "North", locationId: "north", batchId: "b",
  };
  render(<UpcomingSessionsList initialSessions={[row]} coaches={[]} terminology={{ locale: "en", overrides: {} }} canManage />);
  const article = screen.getByRole("article", { name: "Beginners at North" });
  const toggle = within(article).getByRole("button", { name: "Manage" });
  toggle.focus();
  fireEvent.click(toggle);
  const panel = within(article).getByTestId("selected-session");
  expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
  expect(document.activeElement).toBe(toggle);
  expect(within(panel).getByRole("button", { name: "Reschedule" })).toBeTruthy();
});

it("surfaces scoped guardian contact next to medical notes and links only valid numbers", async () => {
  render(await CoachMemberDetailPage({ params: Promise.resolve({ memberId }) }));
  const contact = screen.getByRole("region", { name: "Contact and safety" });
  expect(within(contact).getByText("Check shoulder")).toBeTruthy();
  expect(within(contact).getByRole("link", { name: "Call Geeta Iyer" }).getAttribute("href")).toBe("tel:+919812340017");
  expect(within(contact).getByText("Alternate guardian")).toBeTruthy();
  expect(within(contact).queryByRole("link", { name: "Call Alternate guardian" })).toBeNull();
});

it("holds the counted cash and checks the live close outcome before enabling another submission", async () => {
  const summary: ReceptionCloseSummary = { onDate: "2026-11-21", locations: [{
    locationId: "north", locationName: "North", paymentCount: 1, totalPaise: 10000,
    cashPaise: 10000, upiPaise: 0, bankTransferPaise: 0, methods: [], closed: false, cashCount: null,
  }] };
  actions.confirm.mockRejectedValueOnce(new Error("network"));
  actions.read.mockResolvedValueOnce(summary);
  render(<ReceptionCloseDay summary={summary} reviewThresholdPaise={50000} ownerCloseThresholdPaise={200000} />);
  const counted = screen.getByRole<HTMLInputElement>("textbox", { name: "Counted cash (₹)" });
  fireEvent.change(counted, { target: { value: "100" } });
  const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /Confirm cash count/ });
  fireEvent.click(confirm);
  const check = await screen.findByRole("button", { name: "Check close status" });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(check);
  await screen.findByText(/Still open.*review the count/i);
  expect(counted.value).toBe("100");
  expect(confirm.disabled).toBe(false);
  expect(actions.confirm).toHaveBeenCalledTimes(1);
});

it("separates the child's publication status, deliberate name approval and privacy action", async () => {
  render(await FamilyShowcasePage({ params: Promise.resolve({ memberId }), searchParams: Promise.resolve({}) }));
  const status = screen.getByRole("region", { name: "Publication status" });
  expect(within(status).getByText("Private")).toBeTruthy();
  expect(within(status).getByText("Waiting for a guardian's approval.")).toBeTruthy();
  const approval = screen.getByRole("region", { name: "Public name and approval" });
  const name = within(approval).getByRole("textbox");
  expect(document.getElementById(name.getAttribute("aria-describedby")!)?.textContent).toMatch(/cannot be changed/i);
  const privacy = screen.getByRole("region", { name: "Privacy choice" });
  expect(within(privacy).getByRole("button", { name: "Keep the page private" })).toBeTruthy();
});
