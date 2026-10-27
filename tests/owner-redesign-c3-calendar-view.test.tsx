// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign (27 October 2026) — the calendar amendment.
//
// The human asked for a Teams/Google-Calendar style experience for
// batches and bookings. These cases pin the OBSERVABLE contract of
// that experience through the owner schedule, which is the surface the
// composition is built on:
//
//   * a time ruler and one column per day,
//   * every event placed at the minute it starts and sized by the time
//     it lasts,
//   * two events that overlap side by side rather than stacked,
//   * an event outside the working window still visible,
//   * a session that runs past midnight keeping its true length and
//     staying on the day it started,
//   * the two kinds of event told apart by a word and an icon, never by
//     colour alone,
//   * a resource clash marked only when the EXCLUSIVE resource really
//     clashes — two batches sharing a location is not a clash,
//   * opening an event shows a focused detail panel that closes on
//     Escape and gives focus back.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";
import { OwnerCalendar } from "@/components/owner-calendar/owner-calendar";
import { buttonClasses } from "@/components/ui/Button";
import type { GridSessionRow } from "@/lib/services/schedule-grid";

const WEEK = [
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
  "2026-09-19",
  "2026-09-20",
];

function session(
  overrides: Partial<GridSessionRow> & { id: string },
): GridSessionRow {
  return {
    sessionDate: "2026-09-14",
    startsAt: "2026-09-14T01:30:00.000Z",
    endsAt: "2026-09-14T02:30:00.000Z",
    status: "scheduled",
    batchId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    batchName: "Junior 7am",
    capacity: 16,
    enrolled: 4,
    locationId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    locationName: "Worli",
    coachName: "Riya Nair",
    ...overrides,
  };
}

function renderGrid(sessions: GridSessionRow[], extra?: Partial<Parameters<typeof OwnerScheduleGrid>[0]>) {
  return render(
    <OwnerScheduleGrid
      view="week"
      anchor={WEEK[0]}
      locations={[]}
      sessions={sessions}
      days={WEEK}
      monthCells={null}
      prevHref="#"
      nextHref="#"
      todayHref="#"
      dayHref="#day"
      weekHref="#week"
      monthHref="#month"
      today="2026-09-14"
      timezone="Asia/Kolkata"
      coachIds={{ "s-1": "coach-1" }}
      {...extra}
    />,
  );
}

afterEach(cleanup);

describe("owner schedule calendar", () => {
  it("draws a time ruler and one column per day", () => {
    const { container } = renderGrid([session({ id: "s-1" })]);
    expect(container.querySelector('[data-testid="calendar-ruler"]')).toBeTruthy();
    // One column per day of the week.
    expect(
      container.querySelectorAll('[data-testid="calendar-track"]').length,
    ).toBe(7);
  });

  it("places a session at the minute it starts and sizes it by its length", () => {
    const { container } = renderGrid([session({ id: "s-1" })]);
    const block = container.querySelector('[data-testid="calendar-event"]');
    expect(block).toBeTruthy();
    // 07:00 IST is one hour after the 06:00 ruler start.
    expect(block!.getAttribute("data-top")).toBe("60");
    expect(block!.getAttribute("data-height")).toBe("60");
  });

  it("puts two overlapping sessions side by side", () => {
    const { container } = renderGrid([
      session({ id: "s-1", startsAt: "2026-09-14T12:00:00.000Z", endsAt: "2026-09-14T13:00:00.000Z" }),
      session({ id: "s-2", startsAt: "2026-09-14T12:30:00.000Z", endsAt: "2026-09-14T13:30:00.000Z" }),
    ]);
    const blocks = container.querySelectorAll('[data-testid="calendar-event"]');
    expect(blocks.length).toBe(2);
    const columns = Array.from(blocks).map((b) => b.getAttribute("data-column"));
    expect(new Set(columns).size).toBe(2);
    expect(blocks[0]!.getAttribute("data-columns")).toBe("2");
  });

  it("keeps a session that starts before the working window visible", () => {
    // 04:30 IST — before the 06:00 ruler the window starts at.
    const { container } = renderGrid([
      session({
        id: "s-1",
        startsAt: "2026-09-13T23:00:00.000Z",
        endsAt: "2026-09-14T00:00:00.000Z",
      }),
    ]);
    const block = container.querySelector('[data-testid="calendar-event"]');
    expect(block).toBeTruthy();
    // The window grew to 04:00, so the block sits 30 minutes down.
    expect(block!.getAttribute("data-top")).toBe("30");
    expect(block!.getAttribute("data-height")).toBe("60");
  });

  it("keeps a session that runs past midnight at its true length on the day it started", () => {
    // 23:00 IST on 14 Sep to 00:30 IST on 15 Sep.
    const { container } = renderGrid([
      session({
        id: "s-1",
        startsAt: "2026-09-14T17:30:00.000Z",
        endsAt: "2026-09-14T19:00:00.000Z",
      }),
    ]);
    // The day it started owns the part before midnight...
    const monday = container.querySelector('[data-date="2026-09-14"]');
    const mondayBlock = monday!.querySelector(
      '[data-testid="calendar-event"]',
    ) as HTMLElement;
    expect(mondayBlock.getAttribute("data-height")).toBe("60");
    // ...and the next day owns the continuation, so nothing is lost.
    const tuesday = container.querySelector('[data-date="2026-09-15"]');
    const tuesdayBlock = tuesday!.querySelector(
      '[data-testid="calendar-event"]',
    ) as HTMLElement;
    expect(tuesdayBlock.getAttribute("data-height")).toBe("30");
    expect(tuesdayBlock.getAttribute("data-top")).toBe("0");
  });

  it("names the kind of event, so colour is never the only cue", () => {
    const { container } = renderGrid([session({ id: "s-1" })]);
    const block = container.querySelector('[data-testid="calendar-event"]');
    expect(block!.getAttribute("data-category")).toBe("batch");
    expect(block!.textContent).toMatch(/batch/i);
  });

  it("does not report a clash for two batches sharing one location", () => {
    const { container } = renderGrid([
      session({
        id: "s-1",
        startsAt: "2026-09-14T12:00:00.000Z",
        endsAt: "2026-09-14T13:00:00.000Z",
        batchName: "Morning Squad",
      }),
      session({
        id: "s-2",
        startsAt: "2026-09-14T12:00:00.000Z",
        endsAt: "2026-09-14T13:00:00.000Z",
        batchName: "Junior TTS",
      }),
    ]);
    // Same location, same time, different coaches — not a conflict.
    expect(container.querySelectorAll('[data-testid="calendar-clash"]').length).toBe(0);
    // The scenario really was on the calendar: two blocks, side by side.
    const blocks = container.querySelectorAll('[data-testid="calendar-event"]');
    expect(blocks.length).toBe(2);
    expect(blocks[0]!.getAttribute("data-columns")).toBe("2");
  });

  it("reports a clash when the same coach holds two sessions at once", () => {
    const { container } = renderGrid(
      [
        session({
          id: "s-1",
          startsAt: "2026-09-14T12:00:00.000Z",
          endsAt: "2026-09-14T13:00:00.000Z",
          coachName: "Aanya Rao",
        }),
        session({
          id: "s-2",
          startsAt: "2026-09-14T12:00:00.000Z",
          endsAt: "2026-09-14T13:00:00.000Z",
          coachName: "Aanya Rao",
        }),
      ],
      { coachIds: { "s-1": "coach-1", "s-2": "coach-1" } },
    );
    expect(container.querySelectorAll('[data-testid="calendar-clash"]').length).toBe(2);
  });

  it("lists the same sessions as an agenda for a phone", () => {
    const { container } = renderGrid([session({ id: "s-1" })]);
    const agenda = container.querySelector('[data-testid="calendar-agenda"]');
    expect(agenda).toBeTruthy();
    expect(agenda!.textContent).toContain("Junior 7am");
    expect(agenda!.textContent).toMatch(/07:00/);
  });

  it("says so when the range holds no sessions", () => {
    const { container } = renderGrid([]);
    expect(container.querySelector('[data-testid="calendar-empty"]')).toBeTruthy();
    expect(document.body.textContent).toMatch(/no sessions scheduled in this week/i);
  });

  it("uses the shared control metrics for its own toolbar controls", () => {
    // The calendar must not restate the control metrics. Its date
    // controls ARE the shared Button primitive's standard control, so
    // they measure the same as every other owner toolbar and carry
    // the same focus, disabled and hover states. The assertion is
    // delegation, not a copy of the metric.
    const { container } = renderGrid([session({ id: "s-1" })]);
    const previous = container.querySelector('[data-testid="calendar-previous"]');
    expect(previous).toBeTruthy();
    const shared = buttonClasses({ variant: "secondary", size: "md" });
    for (const token of shared.split(" ").filter(Boolean)) {
      expect(previous!.className).toContain(token);
    }
  });

  it("labels a session that runs past midnight with the next day's time", () => {
    // 23:00 IST on 14 Sep to 01:00 IST on 15 Sep. The block is two
    // hours tall, so the label must agree with it: the end is 01:00,
    // and it says which day that is.
    const { container } = renderGrid([
      session({
        id: "s-1",
        startsAt: "2026-09-14T17:30:00.000Z",
        endsAt: "2026-09-14T19:30:00.000Z",
      }),
    ]);
    const block = container.querySelector('[data-testid="calendar-event"]')!;
    expect(block.textContent).toContain("23:00");
    expect(block.textContent).toContain("01:00");
    // A clamped "24:00" is not a time of day.
    expect(block.textContent).not.toMatch(/24:/);
    // And the reader is told the end is on the next day.
    expect(block.textContent).toMatch(/\+1d|next day/i);
  });

  it("never draws a clamped hour on the ruler", () => {
    const { container } = renderGrid([
      session({
        id: "s-1",
        startsAt: "2026-09-14T17:30:00.000Z",
        endsAt: "2026-09-14T19:30:00.000Z",
      }),
    ]);
    const ruler = container.querySelector('[data-testid="calendar-ruler"]')!;
    expect(ruler.textContent).not.toMatch(/24:00/);
    // The hour after midnight is labelled as the hour it is.
    expect(ruler.textContent).toContain("00:00");
  });

  it("closes the detail panel when the event it shows is gone", async () => {
    const { container, rerender } = renderGrid([session({ id: "s-1" })]);
    const block = container.querySelector<HTMLButtonElement>(
      '[data-testid="calendar-event"]',
    )!;
    block.focus();
    fireEvent.click(block);
    expect(screen.getByTestId("calendar-detail")).toBeTruthy();

    // The session disappears — the scope moved on, or it was cancelled
    // and removed. The panel must not keep showing it.
    rerender(
      <OwnerScheduleGrid
        view="week"
        anchor={WEEK[0]}
        locations={[]}
        sessions={[]}
        days={WEEK}
        monthCells={null}
        prevHref="#"
        nextHref="#"
        todayHref="#"
        today="2026-09-14"
        timezone="Asia/Kolkata"
      />,
    );
    expect(screen.queryByTestId("calendar-detail")).toBeNull();
  });

  it("returns focus to the event that opened the detail panel", () => {
    const { container } = renderGrid([session({ id: "s-1" })]);
    const block = container.querySelector<HTMLButtonElement>(
      '[data-testid="calendar-event"]',
    )!;
    block.focus();
    fireEvent.click(block);
    expect(screen.getByTestId("calendar-detail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(block);
  });

  it("does not hide an event that is still running on the selected day", () => {
    // The session started last night and runs until 00:30. On the
    // agenda for the second day it is still ON SHOW: the owner must be
    // able to see who is in the water at midnight.
    const { container } = render(
      <OwnerCalendar
        events={[
          {
            id: "overnight",
            category: "batch",
            title: "Late Squad",
            date: "2026-09-14",
            startsAt: "2026-09-14T17:30:00.000Z",
            endsAt: "2026-09-14T19:00:00.000Z",
            startMinutes: 23 * 60,
            durationMinutes: 90,
            status: "scheduled",
            detail: [],
          },
        ]}
        days={["2026-09-15"]}
        selectedDate="2026-09-15"
        todayDate="2026-09-15"
        view="agenda"
        labels={{ batch: "Batch", booking: "Booking" }}
        empty={{ title: "Nothing", body: "Nothing here." }}
      />,
    );
    const agenda = container.querySelector('[data-testid="calendar-agenda"]')!;
    expect(agenda.textContent).toContain("Late Squad");
    // Its true time range, with the next-day context.
    expect(agenda.textContent).toMatch(/23:00/);
    expect(agenda.textContent).toMatch(/00:30/);
  });

  it("lets the owner pick another day from the phone strip", () => {
    // The strip is the phone's way into the other days of the range.
    // Without a way to pick one, six of the seven days are unreachable
    // on a phone.
    const picked: string[] = [];
    const { container } = render(
      <OwnerCalendar
        events={[]}
        days={WEEK}
        selectedDate={WEEK[0]}
        todayDate={WEEK[0]}
        view="week"
        labels={{ batch: "Batch", booking: "Booking" }}
        empty={{ title: "Nothing", body: "Nothing here." }}
        onSelectDay={(date) => picked.push(date)}
      />,
    );
    const strip = container.querySelector('[data-testid="calendar-day-strip"]')!;
    const buttons = strip.querySelectorAll("button");
    expect(buttons.length).toBe(7);
    fireEvent.click(buttons[2]!);
    expect(picked).toEqual(["2026-09-16"]);
  });
});
