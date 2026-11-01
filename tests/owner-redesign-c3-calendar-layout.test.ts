import { describe, expect, it } from "vitest";

import {
  bucketByDate,
  calendarRange,
  clockToMinutes,
  detectClashes,
  layoutDay,
  minutesToClock,
  resolveGeometry,
  wallClock,
} from "@/components/owner-calendar/calendar-layout";
import {
  projectOntoDay,
  projectOntoDays,
  type DayProjection,
} from "@/components/owner-calendar/calendar-projection";
import {
  DEFAULT_GEOMETRY,
  type CalendarEvent,
} from "@/components/owner-calendar/calendar-model";

// Owner redesign (27 October 2026) — the calendar amendment.
//
// The human asked for a Teams/Google-Calendar style experience for
// batches and bookings. These cases pin the arithmetic that makes
// that honest: an event's block must sit at the minute it starts and
// be as tall as it lasts, two events that overlap must be visible side
// by side rather than stacked on one another, a session that runs past
// midnight must not spill into the next day, and two events that
// merely happen at the same moment on different resources must NOT be
// dressed up as a conflict.
//
// The display zone is Asia/Kolkata, so the boundary cases are stated in
// IST rather than in whatever the runner's clock happens to be.

const GEOMETRY = DEFAULT_GEOMETRY;

/** The projections of a set of events onto the day each one starts. */
function projected(events: CalendarEvent[]): DayProjection[] {
  const out: DayProjection[] = [];
  for (const event of events) {
    const projection = projectOntoDay(event, event.date);
    if (projection) out.push(projection);
  }
  return out;
}

function event(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  const startMinutes = overrides.startMinutes ?? 7 * 60;
  const durationMinutes = overrides.durationMinutes ?? 60;
  const date = overrides.date ?? "2026-10-27";
  // The instants follow the wall clock, so the two never disagree: the
  // projection reads the instants, the layout reads the projection.
  const startsAt = istInstant(date, startMinutes);
  const endsAt = new Date(
    new Date(startsAt).getTime() + durationMinutes * 60_000,
  ).toISOString();
  return {
    category: "batch",
    title: "Morning Squad",
    date,
    startsAt,
    endsAt,
    startMinutes,
    durationMinutes,
    status: "scheduled",
    detail: [],
    ...overrides,
  };
}

/** The IST instant of a wall clock on a day. */
function istInstant(dateIso: string, minutes: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(
    Date.UTC(y!, m! - 1, d!, 0, 0, 0) + (minutes - 330) * 60_000,
  ).toISOString();
}

describe("calendar wall clock (IST)", () => {
  it("reads an instant as the academy's wall clock, not the runner's", () => {
    // 18:30 UTC is 00:00 IST on the next day.
    const clock = wallClock("2026-10-27T18:30:00.000Z");
    expect(clock.date).toBe("2026-10-28");
    expect(clock.minutes).toBe(0);
  });

  it("keeps an afternoon instant on its own day", () => {
    const clock = wallClock("2026-10-27T09:15:00.000Z");
    expect(clock.date).toBe("2026-10-27");
    expect(clock.minutes).toBe(14 * 60 + 45);
  });

  it("round-trips a clock string through minutes", () => {
    expect(clockToMinutes("07:30")).toBe(450);
    expect(minutesToClock(450)).toBe("07:30");
    expect(minutesToClock(0)).toBe("00:00");
  });
});

describe("calendar day layout", () => {
  it("places a block at its start minute and sizes it by its duration", () => {
    const placed = layoutDay(projected([event({ id: "a", startMinutes: 7 * 60, durationMinutes: 60 })]),
      GEOMETRY,
    );
    expect(placed).toHaveLength(1);
    // The ruler starts at 06:00, so 07:00 is one hour down.
    expect(placed[0]!.top).toBe(60);
    expect(placed[0]!.height).toBe(60);
    expect(placed[0]!.column).toBe(0);
    expect(placed[0]!.columns).toBe(1);
  });

  it("gives two overlapping events their own columns", () => {
    const placed = layoutDay(projected([
        event({ id: "a", startMinutes: 18 * 60, durationMinutes: 60 }),
        event({ id: "b", startMinutes: 18 * 60 + 30, durationMinutes: 60 }),
      ]),
      GEOMETRY,
    );
    expect(placed).toHaveLength(2);
    expect(placed.map((p) => p.column).sort()).toEqual([0, 1]);
    expect(placed.every((p) => p.columns === 2)).toBe(true);
  });

  it("reuses a column once the earlier event has ended", () => {
    const placed = layoutDay(projected([
        event({ id: "a", startMinutes: 6 * 60, durationMinutes: 60 }),
        event({ id: "b", startMinutes: 6 * 60 + 30, durationMinutes: 60 }),
        event({ id: "c", startMinutes: 7 * 60, durationMinutes: 60 }),
      ]),
      GEOMETRY,
    );
    const byId = new Map(placed.map((p) => [p.event.id, p]));
    expect(byId.get("a")!.column).toBe(0);
    expect(byId.get("b")!.column).toBe(1);
    // 07:00 is exactly when "a" ends, so "c" may take column 0 again.
    expect(byId.get("c")!.column).toBe(0);
  });

  it("does not treat two touching events as overlapping", () => {
    const placed = layoutDay(projected([
        event({ id: "a", startMinutes: 6 * 60, durationMinutes: 60 }),
        event({ id: "b", startMinutes: 7 * 60, durationMinutes: 60 }),
      ]),
      GEOMETRY,
    );
    expect(placed).toHaveLength(2);
    expect(placed.every((p) => p.columns === 1)).toBe(true);
    expect(placed.map((p) => p.column)).toEqual([0, 0]);
  });

  it("gives a cluster of three simultaneous events three columns", () => {
    const placed = layoutDay(projected([
        event({ id: "a", startMinutes: 18 * 60, durationMinutes: 60 }),
        event({ id: "b", startMinutes: 18 * 60, durationMinutes: 60 }),
        event({ id: "c", startMinutes: 18 * 60, durationMinutes: 60 }),
      ]),
      GEOMETRY,
    );
    expect(placed.map((p) => p.column).sort()).toEqual([0, 1, 2]);
    expect(placed.every((p) => p.columns === 3)).toBe(true);
  });
});

describe("calendar resource clashes", () => {
  it("flags two events that overlap on the SAME resource", () => {
    const clashing = detectClashes([
      event({ id: "a", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1" }),
      event({ id: "b", startMinutes: 18 * 60 + 30, durationMinutes: 60, resourceKey: "coach-1" }),
    ]);
    expect([...clashing].sort()).toEqual(["a", "b"]);
  });

  it("does not flag simultaneity on different resources", () => {
    // Control first: the very same pair on ONE resource must be
    // flagged, so this case cannot pass by the detector being absent.
    const sameResource = detectClashes([
      event({ id: "a", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1" }),
      event({ id: "b", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1" }),
    ]);
    expect(sameResource.size).toBe(2);

    const differentResources = detectClashes([
      event({ id: "a", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1" }),
      event({ id: "b", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-2" }),
    ]);
    expect(differentResources.size).toBe(0);
  });

  it("does not flag the same resource at the same time on different days", () => {
    const sameDay = detectClashes([
      event({ id: "a", date: "2026-10-27", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1" }),
      event({ id: "b", date: "2026-10-27", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1" }),
    ]);
    expect(sameDay.size).toBe(2);

    // The same hour on the NEXT day: the same coach is free by then.
    const differentDays = detectClashes([
      event({
        id: "a",
        date: "2026-10-27",
        startMinutes: 18 * 60,
        durationMinutes: 60,
        startsAt: "2026-10-27T12:30:00.000Z",
        endsAt: "2026-10-27T13:30:00.000Z",
        resourceKey: "coach-1",
      }),
      event({
        id: "b",
        date: "2026-10-28",
        startMinutes: 18 * 60,
        durationMinutes: 60,
        startsAt: "2026-10-28T12:30:00.000Z",
        endsAt: "2026-10-28T13:30:00.000Z",
        resourceKey: "coach-1",
      }),
    ]);
    expect(differentDays.size).toBe(0);
  });

  it("does not flag a cancelled event, which occupies no slot", () => {
    const bothLive = detectClashes([
      event({ id: "a", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1" }),
      event({ id: "b", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1" }),
    ]);
    expect(bothLive.size).toBe(2);

    const withCancelled = detectClashes([
      event({ id: "a", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1", status: "cancelled" }),
      event({ id: "b", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1" }),
    ]);
    expect(withCancelled.size).toBe(0);
  });

  it("marks the placed event as clashing", () => {
    const placed = layoutDay(projected([
        event({ id: "a", startMinutes: 18 * 60, durationMinutes: 60, resourceKey: "coach-1" }),
        event({ id: "b", startMinutes: 18 * 60 + 30, durationMinutes: 60, resourceKey: "coach-1" }),
      ]),
      GEOMETRY,
    );
    expect(placed.every((p) => p.clash)).toBe(true);
  });
});

describe("the ruler must not hide supported schedule data", () => {
  it("keeps the default working window when every event sits inside it", () => {
    const geometry = resolveGeometry(
      [event({ id: "a", startMinutes: 9 * 60, durationMinutes: 60 })],
      GEOMETRY,
    );
    expect(geometry.dayStartMinutes).toBe(GEOMETRY.dayStartMinutes);
    expect(geometry.dayEndMinutes).toBe(GEOMETRY.dayEndMinutes);
  });

  it("extends the window upwards for an early-morning session", () => {
    // 04:30 is before the 06:00 default. The session must stay visible
    // rather than being clipped by the ruler's start.
    const geometry = resolveGeometry(
      [event({ id: "a", startMinutes: 4 * 60 + 30, durationMinutes: 60 })],
      GEOMETRY,
    );
    expect(geometry.dayStartMinutes).toBe(4 * 60);
    expect(geometry.dayEndMinutes).toBe(GEOMETRY.dayEndMinutes);
  });

  it("extends the window downwards for a late-evening session", () => {
    const geometry = resolveGeometry(
      [event({ id: "a", startMinutes: 23 * 60, durationMinutes: 60 })],
      GEOMETRY,
    );
    expect(geometry.dayEndMinutes).toBe(24 * 60);
    expect(geometry.dayStartMinutes).toBe(GEOMETRY.dayStartMinutes);
  });

  it("keeps a session that runs past midnight at its true length", () => {
    // 23:00 to 00:30 is ninety minutes. It must not be trimmed to the
    // end of the day, and it must not be moved to the next day.
    const crossMidnight = event({
      id: "a",
      date: "2026-10-27",
      startMinutes: 23 * 60,
      durationMinutes: 90,
    });
    const geometry = resolveGeometry([crossMidnight], GEOMETRY, [
      "2026-10-27",
      "2026-10-28",
    ]);
    // The ruler never runs past the end of a day: the part after
    // midnight belongs to the NEXT day's track, not to this one.
    expect(geometry.dayEndMinutes).toBeLessThanOrEqual(24 * 60);
    expect(geometry.dayEndMinutes).toBeGreaterThanOrEqual(23 * 60);

    // The day it starts owns the part before midnight...
    const placed = layoutDay(projected([crossMidnight]), geometry);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.height).toBe(60);
    expect(placed[0]!.event.date).toBe("2026-10-27");
    expect(placed[0]!.top).toBe(
      (23 * 60 - geometry.dayStartMinutes) * geometry.pixelsPerMinute,
    );

    // ...and the next day owns the continuation, so nothing is lost.
    const continuation = projectOntoDay(crossMidnight, "2026-10-28");
    expect(continuation).not.toBeNull();
    expect(continuation!.startMinutes).toBe(0);
    expect(continuation!.durationMinutes).toBe(30);
  });

  it("places a cross-midnight session on the IST day it starts", () => {
    // 18:30 UTC on the 27th is 00:00 IST on the 28th.
    const clock = wallClock("2026-10-27T18:30:00.000Z");
    expect(clock.date).toBe("2026-10-28");
  });
});

describe("a clash is judged on the real instants, not on the day", () => {
  // A session that runs from Monday 23:00 into Tuesday 00:30 really
  // overlaps a Tuesday 00:00 session. Grouping by the day the event
  // STARTS on would never let the two meet.
  const overnight = event({
    id: "overnight",
    date: "2026-10-26",
    startMinutes: 23 * 60,
    durationMinutes: 90,
    startsAt: "2026-10-26T17:30:00.000Z",
    endsAt: "2026-10-26T19:00:00.000Z",
    resourceKey: "coach-1",
  });
  const nextDay = event({
    id: "next-day",
    date: "2026-10-27",
    startMinutes: 0,
    durationMinutes: 60,
    startsAt: "2026-10-26T18:30:00.000Z",
    endsAt: "2026-10-26T19:30:00.000Z",
    resourceKey: "coach-1",
  });

  it("flags two events that overlap across midnight", () => {
    const clashing = detectClashes([overnight, nextDay]);
    expect([...clashing].sort()).toEqual(["next-day", "overnight"]);
  });

  it("does not flag events that merely touch across midnight", () => {
    const touching = event({
      id: "touching",
      date: "2026-10-27",
      startMinutes: 30,
      durationMinutes: 60,
      startsAt: "2026-10-26T19:00:00.000Z",
      endsAt: "2026-10-26T20:00:00.000Z",
      resourceKey: "coach-1",
    });
    const clashing = detectClashes([overnight, touching]);
    expect(clashing.size).toBe(0);
  });

  it("does not flag the overlap when the resource differs", () => {
    const other = { ...nextDay, id: "other", resourceKey: "coach-2" };
    const clashing = detectClashes([overnight, other]);
    expect(clashing.size).toBe(0);
  });

  it("does not flag a cancelled event, which occupies no slot", () => {
    const cancelled = { ...nextDay, id: "cancelled", status: "cancelled" };
    const clashing = detectClashes([overnight, cancelled]);
    expect(clashing.size).toBe(0);
  });

  it("still flags two events that overlap inside one day", () => {
    const a = event({
      id: "a",
      startMinutes: 18 * 60,
      durationMinutes: 60,
      resourceKey: "coach-1",
    });
    const b = event({
      id: "b",
      startMinutes: 18 * 60 + 30,
      durationMinutes: 60,
      resourceKey: "coach-1",
    });
    expect([...detectClashes([a, b])].sort()).toEqual(["a", "b"]);
  });
});

describe("calendar grouping and range", () => {  it("groups events by their IST day", () => {
    const buckets = bucketByDate([
      event({ id: "a", date: "2026-10-27" }),
      event({ id: "b", date: "2026-10-28" }),
      event({ id: "c", date: "2026-10-27", startMinutes: 9 * 60 }),
    ]);
    expect([...buckets.keys()].sort()).toEqual(["2026-10-27", "2026-10-28"]);
    expect(buckets.get("2026-10-27")!.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("builds a Monday-first week around the anchor", () => {
    // 2026-10-27 is a Tuesday.
    const range = calendarRange("2026-10-27", "week");
    expect(range.days[0]).toBe("2026-10-26");
    expect(range.days).toHaveLength(7);
    expect(range.days[6]).toBe("2026-11-01");
    expect(range.previousDate).toBe("2026-10-19");
    expect(range.nextDate).toBe("2026-11-02");
  });

  it("keeps a Sunday inside the week that starts on the Monday before it", () => {
    // 2026-11-01 is a Sunday.
    const range = calendarRange("2026-11-01", "week");
    expect(range.days[0]).toBe("2026-10-26");
    expect(range.days[6]).toBe("2026-11-01");
  });

  it("builds a single-day range", () => {
    const range = calendarRange("2026-10-27", "day");
    expect(range.days).toEqual(["2026-10-27"]);
    expect(range.previousDate).toBe("2026-10-26");
    expect(range.nextDate).toBe("2026-10-28");
  });
});

describe("an event is projected onto the day it touches", () => {
  // A session that runs from Monday 23:00 into Tuesday 00:30 touches
  // TWO days. Each day gets the part of the session that falls in it,
  // and the continuation belongs to the SECOND day's track — beside
  // the events that start after midnight, not below midnight in the
  // first day's column.
  const overnight: CalendarEvent = {
    id: "overnight",
    category: "batch",
    title: "Late Squad",
    date: "2026-10-26",
    startsAt: "2026-10-26T17:30:00.000Z",
    endsAt: "2026-10-26T19:00:00.000Z",
    startMinutes: 23 * 60,
    durationMinutes: 90,
    status: "scheduled",
    detail: [],
  };

  it("gives the first day the part before midnight", () => {
    const projection = projectOntoDay(overnight, "2026-10-26");
    expect(projection).not.toBeNull();
    expect(projection!.startMinutes).toBe(23 * 60);
    expect(projection!.durationMinutes).toBe(60);
  });

  it("gives the next day the continuation", () => {
    const projection = projectOntoDay(overnight, "2026-10-27");
    expect(projection).not.toBeNull();
    expect(projection!.startMinutes).toBe(0);
    expect(projection!.durationMinutes).toBe(30);
  });

  it("gives a day the event does not touch nothing", () => {
    expect(projectOntoDay(overnight, "2026-10-28")).toBeNull();
  });

  it("projects an event onto every day it touches", () => {
    const projections = projectOntoDays(
      [overnight],
      ["2026-10-26", "2026-10-27", "2026-10-28"],
    );
    expect(projections.get("2026-10-26")).toHaveLength(1);
    expect(projections.get("2026-10-27")).toHaveLength(1);
    expect(projections.get("2026-10-28")).toHaveLength(0);
  });
});

describe("the ruler is drawn from what the days actually show", () => {
  // A session that runs from Monday 23:00 into Tuesday 00:30 is the
  // only thing on show. The ruler must still cover it: the Tuesday
  // continuation sits at 00:00, so the day's track has to begin at
  // midnight — and the Monday column must not be stretched past 24:00
  // by an event that belongs to the next day.
  const overnight = event({
    id: "overnight",
    date: "2026-10-26",
    startMinutes: 23 * 60,
    durationMinutes: 90,
  });

  it("starts the ruler at midnight when the day begins at midnight", () => {
    const geometry = resolveGeometry([overnight], GEOMETRY, [
      "2026-10-26",
      "2026-10-27",
    ]);
    expect(geometry.dayStartMinutes).toBe(0);
    // The ruler never runs past the end of a day.
    expect(geometry.dayEndMinutes).toBeLessThanOrEqual(24 * 60);
  });

  it("keeps every projected block inside its day's track", () => {
    const days = ["2026-10-26", "2026-10-27"];
    const geometry = resolveGeometry([overnight], GEOMETRY, days);
    const trackHeight =
      (geometry.dayEndMinutes - geometry.dayStartMinutes) *
      geometry.pixelsPerMinute;
    for (const day of days) {
      const projections = projectOntoDays([overnight], [day]).get(day) ?? [];
      for (const placed of layoutDay(projections, geometry)) {
        expect(placed.top).toBeGreaterThanOrEqual(0);
        expect(placed.top + placed.height).toBeLessThanOrEqual(trackHeight);
      }
    }
  });

  it("shows the continuation at midnight on the next day", () => {
    const geometry = resolveGeometry([overnight], GEOMETRY, [
      "2026-10-26",
      "2026-10-27",
    ]);
    const projections = projectOntoDays([overnight], ["2026-10-27"]).get(
      "2026-10-27",
    )!;
    const placed = layoutDay(projections, geometry);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.top).toBe(0);
    expect(placed[0]!.height).toBe(30);
  });
});
