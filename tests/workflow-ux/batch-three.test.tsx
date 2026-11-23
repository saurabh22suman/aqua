// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EnquiriesBoard } from "@/components/enquiries-board";
import { MembersBoard } from "@/components/members-board";
import ReceptionMembersPage from "@/app/(reception)/reception/members/page";
import CoachSchedulePage from "@/app/(coach)/coach/schedule/page";
import type { EnquiryRow } from "@/lib/services/enquiries";
import type { MemberListRow } from "@/lib/services/people";

const mock = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/actions/enquiries", () => ({ createEnquiryAction: mock.create }));
vi.mock("@/lib/actions/people", () => ({ listMembersAction: mock.list }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ overrides: {}, locale: "en" }) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireReception: async () => ({}), requireCoach: async () => ({}) }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock("@/lib/actions/coach", () => ({
  getScheduleAction: async () => ({
    from: "2026-11-21", to: "2026-11-22",
    days: [
      { date: "2026-11-21", sessions: [] },
      { date: "2026-11-22", sessions: [{
        id: "s1", sessionDate: "2026-11-22", batchName: "Weekend Group", locationName: "Worli Main",
        startsAt: new Date("2026-11-22T10:30Z"), endsAt: new Date("2026-11-22T11:30Z"), marked: 0, total: 8,
      }] },
    ],
  }),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });
const sample: EnquiryRow = {
  id: "first", fullName: "Priya Joshi", phone: null, source: "walk-in", stage: "new",
  memberId: null, locationId: "site", createdAt: new Date("2026-11-20"),
};
const member = {
  memberId: "m1", personId: "person1", fullName: "Initial Name", memberCode: "AUD-01",
  locationName: "Worli Main", locationId: "site", phone: null, status: "active", isMinor: false,
} as MemberListRow;

it("lets owners move from the overdue summary to a queue containing only enquiries that need follow-up", () => {
  render(<EnquiriesBoard variant="oversight" initialEnquiries={[sample, { ...sample, id: "other", fullName: "Other Lead" }]}
    locations={[{ id: "site", name: "Worli" }]} canWrite
    overdueFollowUps={[{ id: "task", enquiryId: "first", enquiryName: sample.fullName, dueAt: new Date("2026-11-19"), note: "Check schedule" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show follow-up queue" }));
  expect(screen.queryByText("Other Lead")).toBeNull();
  expect(screen.getByRole("link", { name: "Follow up Priya Joshi" })).toBeTruthy();
});

it("lets Reception retrieve an enquiry and returns to an intact capture with a link after saving", async () => {
  render(<EnquiriesBoard initialEnquiries={[sample]} locations={[{ id: "site", name: "Worli" }]} canWrite detailHrefPrefix="/reception/enquiries" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Asha Nayak" } });
  fireEvent.click(screen.getByRole("button", { name: "Find enquiry" }));
  const search = screen.getByRole("searchbox", { name: "Search enquiries" });
  fireEvent.change(search, { target: { value: "Priya" } });
  expect(screen.getByRole("link", { name: "Open Priya Joshi" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Capture enquiry$/ }));
  expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Asha Nayak");
  mock.create.mockResolvedValue({ ...sample, id: "saved", fullName: "Asha Nayak" });
  fireEvent.click(screen.getByTestId("enquiry-capture-submit"));
  expect((await screen.findByRole("link", { name: "Open saved enquiry" })).getAttribute("href")).toBe("/reception/enquiries/saved");
});

it("does not offer old member profiles as actionable results after a newer directory lookup fails", async () => {
  mock.list.mockRejectedValue(new Error("network"));
  render(<MembersBoard initialMembers={[member]} />);
  fireEvent.change(screen.getByTestId("members-search"), { target: { value: "AUD-02" } });
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.queryByRole("link", { name: /Initial Name/ })).toBeNull();
  expect(screen.getByText(/Previous results/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Retry.*search/ })).toBeTruthy();
});

it("gives Reception a retry for a failed lookup without losing the typed search", async () => {
  mock.list.mockRejectedValue(new Error("network"));
  render(await ReceptionMembersPage({ searchParams: Promise.resolve({ q: "AUD-01" }) }));
  expect(screen.getByRole("alert").textContent).toMatch(/Could not search/i);
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("AUD-01");
  expect(screen.getByRole("button", { name: "Retry search" }).getAttribute("form")).toBe("reception-member-search");
});

it("shows the next assigned venue ahead of the week and preserves the day when opening a register", async () => {
  vi.setSystemTime(new Date("2026-11-21T10:00Z"));
  render(await CoachSchedulePage({}));
  const next = screen.getByRole("region", { name: "Next assigned session" });
  expect(next.textContent).toContain("Worli Main");
  expect(screen.getByRole("link", { name: /Open register for Weekend Group/ }).getAttribute("href")).toContain("day=2026-11-22");
  expect(screen.getByRole("navigation", { name: "Schedule days" })).toBeTruthy();
});
