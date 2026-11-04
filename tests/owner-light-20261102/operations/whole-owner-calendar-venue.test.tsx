// @vitest-environment jsdom
//
// Owner light · Operations lane (3 November 2026) — the schedule's session
// secondary line.
//
// On the owner's busiest surface a class was identified by its name and its
// coach, never by its hall: the calendar event's resourceLabel carried the
// coach only, and the venue appeared nowhere except in the detail panel.
// The venue is already read (`GridSessionRow.locationName`), so this is a
// display fix only — no read, no service and no database change.
//
// These cases render the REAL calendar and assert what the owner reads: the
// venue beside the coach, the detail panel's own Location row untouched, and
// a missing coach or venue stated honestly rather than guessed.
//
// Owner: operations lane
// Scope: owner-calendar session event.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OwnerCalendar } from "@/components/owner-calendar/owner-calendar";
import { sessionToCalendarEvent } from "@/components/owner-calendar/calendar-session-event";
import type { CalendarEvent } from "@/components/owner-calendar/calendar-model";
import type { GridSessionRow } from "@/lib/services/schedule-grid";

afterEach(cleanup);

const LABELS = { batch: "Batch", booking: "Booking" };

/** An 18:00–19:00 IST batch session on 2 November 2026. */
const SESSION: GridSessionRow = {
  id: "s-1",
  sessionDate: "2026-11-02",
  startsAt: "2026-11-02T12:30:00.000Z",
  endsAt: "2026-11-02T13:30:00.000Z",
  status: "scheduled",
  batchId: "b-1",
  batchName: "Evening Squad",
  capacity: 12,
  enrolled: 8,
  locationId: "loc-1",
  locationName: "Worli",
  coachName: "Asha Menon",
};

function sessionEvent(overrides: Partial<GridSessionRow> = {}): CalendarEvent {
  return sessionToCalendarEvent(
    { ...SESSION, ...overrides },
    "coach-1",
    "bg-water",
  );
}

function renderCalendar(events: CalendarEvent[]) {
  return render(
    <OwnerCalendar
      events={events}
      days={["2026-11-02"]}
      selectedDate="2026-11-02"
      todayDate="2026-11-02"
      view="day"
      labels={LABELS}
      empty={{ title: "Nothing scheduled", body: "Nothing scheduled." }}
    />,
  );
}

describe("INTENDED RED — a session's calendar line names its venue beside the coach", () => {
  it("carries the coach and the venue in the event's own resource line", () => {
    const label = sessionEvent().resourceLabel ?? "";
    expect(label).toContain("Asha Menon");
    expect(label).toContain("Worli");
  });

  it("names the venue beside the coach on the block and in the agenda", () => {
    renderCalendar([sessionEvent()]);

    const block = screen.getByTestId("calendar-event").textContent ?? "";
    expect(block).toContain("Asha Menon");
    expect(block).toContain("Worli");

    const agenda = screen.getByTestId("calendar-agenda-item").textContent ?? "";
    expect(agenda).toContain("Asha Menon");
    expect(agenda).toContain("Worli");
  });

  it("states a missing coach and a missing venue honestly instead of guessing", () => {
    const label = sessionEvent({ coachName: null, locationName: null })
      .resourceLabel ?? "";
    expect(label).toMatch(/not assigned/i);
    expect(label).toMatch(/no location/i);
  });
});

describe("baseline — the session semantics this change must not touch", () => {
  it("keeps the detail panel's own Location row and the capacity line", async () => {
    renderCalendar([sessionEvent()]);

    fireEvent.click(screen.getByTestId("calendar-event"));
    const detail = await screen.findByTestId("calendar-detail");

    const rows = [...detail.querySelectorAll("dt")].map((cell) => [
      cell.textContent,
      cell.nextElementSibling?.textContent ?? "",
    ]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ["Location", "Worli"],
        ["Coach", "Asha Menon"],
        ["Places", "8 enrolled of 12"],
      ]),
    );

    const block = screen.getByTestId("calendar-event").textContent ?? "";
    expect(block).toContain("8 / 12");
  });

  it("keeps the coach as the event's exclusive resource key", () => {
    expect(sessionEvent().resourceKey).toBe("coach:coach-1");
  });

  it("keeps the session's status and category", () => {
    const event = sessionEvent();
    expect(event.status).toBe("scheduled");
    expect(event.category).toBe("batch");
  });
});
