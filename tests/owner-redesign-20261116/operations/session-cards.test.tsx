// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UpcomingSessionsList } from "@/components/upcoming-sessions-list";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/coach-substitution", () => ({ substituteCoachAction: vi.fn() }));
vi.mock("@/lib/actions/session-lifecycle", () => ({ cancelSessionAction: vi.fn(), rescheduleSessionAction: vi.fn() }));
afterEach(cleanup);
it("distinguishes same-named sessions by location in the list and selected editor", () => {
  const base = { sessionDate: "2030-01-07", startsAt: new Date("2030-01-07T01:30:00Z"), endsAt: new Date("2030-01-07T02:30:00Z"), batchName: "Beginners", coachId: null, coachName: null, status: "scheduled" };
  render(<UpcomingSessionsList initialSessions={[{ ...base, id: "a", batchId: "ba", locationId: "la", locationName: "North" }, { ...base, id: "b", batchId: "bb", locationId: "lb", locationName: "South" }]} coaches={[]} terminology={{ overrides: {}, locale: "en" }} canManage />);
  expect(screen.getByRole("article", { name: "Beginners at North" })).toBeTruthy();
  expect(screen.getByRole("article", { name: "Beginners at South" })).toBeTruthy();
  expect(within(screen.getByTestId("session-a")).getByText(/North/)).toBeTruthy();
  expect(within(screen.getByTestId("session-b")).getByText(/South/)).toBeTruthy();
  fireEvent.click(within(screen.getByTestId("session-b")).getByRole("button", { name: "Manage" }));
  expect(within(screen.getByTestId("selected-session")).getByText(/South/)).toBeTruthy();
});
