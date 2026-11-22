import { expect, it } from "vitest";
import { sessionToCalendarEvent } from "@/components/owner-calendar/calendar-session-event";

it("names calendar capacity as enrolments rather than attendance", () => {
  const event = sessionToCalendarEvent({ id: "session", sessionDate: "2026-11-14", startsAt: "2026-11-14T10:00:00Z", endsAt: "2026-11-14T11:00:00Z", status: "scheduled", batchId: "batch", batchName: "Swim", capacity: 10, enrolled: 3, locationId: "site", locationName: "Main", coachName: null }, null, "");
  expect(event.capacityLabel).toBe("3 / 10 enrolled");
});
