// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";
import { ScheduleMobileAgenda } from "@/components/owner-approved/operations/schedule-mobile-agenda";
import { sessionToCalendarEvent } from "@/components/owner-calendar/calendar-session-event";
afterEach(cleanup);
it("groups each real schedule session with its time, coach, venue and capacity", () => {
  render(<OwnerScheduleGrid view="week" anchor="2026-11-17" locationId="north" locations={[{ id: "north", name: "North" }]} sessions={[{ id: "s", sessionDate: "2026-11-17", startsAt: "2026-11-17T01:30:00Z", endsAt: "2026-11-17T02:30:00Z", status: "scheduled", batchId: "b", batchName: "Beginners", capacity: 12, enrolled: 4, locationId: "north", locationName: "North", coachName: "Anita" }]} days={["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]} monthCells={null} prevHref="#prev" nextHref="#next" todayHref="#today" />);
  const card = screen.getByRole("article", { name: "Beginners at North" });
  expect(within(card).getByRole("button").textContent).toContain("Beginners");
  expect(card.textContent).toContain("North");
  expect(card.textContent).toContain("Anita");
  expect(card.textContent).toContain("4 / 12");
  const startTime = card.querySelector("time");
  expect(startTime?.getAttribute("datetime")).toBe("2026-11-17T01:30:00Z");
  expect(startTime?.textContent).toMatch(/7:00/);
});

it.each([true, false])("visibly identifies the selected day when it is %s", (populated) => {
  const event = sessionToCalendarEvent({ id: "s", sessionDate: "2026-11-17", startsAt: "2026-11-17T01:30:00Z", endsAt: "2026-11-17T02:30:00Z", status: "scheduled", batchId: "b", batchName: "Beginners", capacity: 12, enrolled: 4, locationId: "north", locationName: "North", coachName: "Anita" }, null, "");
  render(<ScheduleMobileAgenda events={populated ? [event] : []} days={["2026-11-16", "2026-11-17"]} selectedDate="2026-11-17" dayHrefs={{"2026-11-16": "/owner/schedule?date=2026-11-16&facility=all", "2026-11-17": "/owner/schedule?date=2026-11-17&facility=all"}} labels={{batch:"Batch",booking:"Booking"}} view="week" />);
  const nav = screen.getByRole("navigation", { name: "Choose a day" });
  const selected = within(nav).getByRole("link", { current: "date" });
  expect(selected.textContent).toContain("Selected");
  expect(selected.getAttribute("href")).toBe("/owner/schedule?date=2026-11-17&facility=all");
  expect(within(nav).getAllByText("Selected")).toHaveLength(1);
  expect(populated ? screen.getByRole("article", { name: "Beginners at North" }) : screen.getByText("Nothing on this day.")).toBeTruthy();
});
