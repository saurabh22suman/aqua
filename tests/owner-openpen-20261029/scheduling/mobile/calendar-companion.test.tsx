// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let measuredTrackWidth = 800;
let observers: ResizeObserverStub[] = [];

class ResizeObserverStub {
  callback: (entries: ResizeObserverEntry[]) => void;
  targets: Element[] = [];
  active = true;
  constructor(callback: (entries: ResizeObserverEntry[]) => void) {
    this.callback = callback;
    observers.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
    this.callback([
      { contentRect: { width: measuredTrackWidth } } as ResizeObserverEntry,
    ]);
  }
  disconnect() {
    this.active = false;
  }
  fire(width: number) {
    if (!this.active) return;
    this.callback([{ contentRect: { width } } as ResizeObserverEntry]);
  }
}

beforeEach(() => {
  measuredTrackWidth = 800;
  observers = [];
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown }) => {
      const { href, children, ...rest } = props as {
        href?: unknown;
        children?: unknown;
        [k: string]: unknown;
      };
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { OwnerCalendar } from "@/components/owner-calendar/owner-calendar";
import type { CalendarEvent } from "@/components/owner-calendar/calendar-model";

const DAY = "2026-11-20";
const NEXT = "2026-11-21";

function event(
  id: string,
  durationMinutes: number,
  startMinutes: number,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id,
    category: "batch",
    title: `Event ${id}`,
    date: DAY,
    startsAt: `2026-11-20T${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}:00+05:30`,
    endsAt: `2026-11-20T${String(Math.floor((startMinutes + durationMinutes) / 60)).padStart(2, "0")}:${String((startMinutes + durationMinutes) % 60).padStart(2, "0")}:00+05:30`,
    startMinutes,
    durationMinutes,
    status: "scheduled",
    detail: [],
    ...overrides,
  };
}

function renderCalendar(events: CalendarEvent[], days = [DAY]) {
  return render(
    <OwnerCalendar
      events={events}
      days={days}
      selectedDate={DAY}
      todayDate={DAY}
      view="week"
      labels={{ batch: "Session", booking: "Booking" }}
      empty={{ title: "No sessions", body: "None." }}
    />,
  );
}

afterEach(cleanup);

it("makes 1/5/23/30/43 minute marks descriptive and keeps 44 interactive", () => {
  const { container } = renderCalendar([
    event("m1", 1, 6 * 60),
    event("m5", 5, 7 * 60),
    event("m23", 23, 8 * 60),
    event("m30", 30, 9 * 60),
    event("m43", 43, 10 * 60),
    event("m44", 44, 11 * 60),
  ]);
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="calendar-event"]'),
  );
  for (const height of ["1", "5", "23", "30", "43"]) {
    const block = blocks.find((node) => node.getAttribute("data-height") === height);
    expect(block?.tagName).toBe("DIV");
    expect(block?.getAttribute("data-interactive")).toBe("false");
  }
  const normal = blocks.find((node) => node.getAttribute("data-height") === "44");
  expect(normal?.tagName).toBe("BUTTON");
  expect(normal?.getAttribute("data-interactive")).toBe("true");
});

it("lists short and narrowed projections in a 44px companion above the grid", () => {
  measuredTrackWidth = 100;
  const { container } = renderCalendar([
    event("a", 30, 12 * 60),
    event("b", 60, 16 * 60),
    event("c", 60, 16 * 60),
    event("d", 60, 16 * 60),
  ]);
  const companion = screen.getByTestId("calendar-short-events");
  const grid = container.querySelector('[data-testid="calendar-grid"]');
  expect(grid).toBeTruthy();
  expect(
    companion.compareDocumentPosition(grid!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const rows = within(companion).getAllByTestId("calendar-agenda-item");
  expect(rows.length).toBe(4);
  for (const row of rows) expect(row.className).toContain("min-h-11");
  fireEvent.click(rows[0]!);
  expect(screen.getByTestId("calendar-detail")).toBeTruthy();
});

it("keeps overnight continuation context in the companion", () => {
  const overnight = event("night", 60, 23 * 60 + 30, {
    startsAt: "2026-11-20T23:30:00+05:30",
    endsAt: "2026-11-21T00:30:00+05:30",
  });
  renderCalendar([overnight], [DAY, NEXT]);
  const companion = screen.getByTestId("calendar-short-events");
  expect(companion.textContent).toContain("Continued from previous day");
});

it("keeps roomy Day overlaps interactive and routes narrow Week overlaps", () => {
  const overlap = [
    event("day-a", 60, 16 * 60),
    event("day-b", 60, 16 * 60),
  ];
  const day = renderCalendar(overlap);
  const dayBlocks = Array.from(
    day.container.querySelectorAll<HTMLElement>('[data-testid="calendar-event"]'),
  );
  for (const block of dayBlocks) {
    expect(block.tagName).toBe("BUTTON");
    expect(block.getAttribute("data-interactive")).toBe("true");
  }
  cleanup();

  measuredTrackWidth = 100;
  const week = renderCalendar(
    [
      event("week-a", 60, 16 * 60),
      event("week-b", 60, 16 * 60),
      event("week-c", 60, 16 * 60),
    ],
    [DAY, NEXT, "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"],
  );
  const weekBlocks = Array.from(
    week.container.querySelectorAll<HTMLElement>('[data-testid="calendar-event"]'),
  );
  for (const block of weekBlocks) {
    expect(block.tagName).toBe("DIV");
    expect(block.getAttribute("data-interactive")).toBe("false");
  }
  expect(screen.getByTestId("calendar-short-events")).toBeTruthy();
});

it("uses plain purpose copy for the companion", () => {
  renderCalendar([event("copy", 30, 12 * 60)]);
  expect(screen.getByText("More events")).toBeTruthy();
  expect(
    screen.getByText(
      "Open short or overlapping events here. The timeline shows their scheduled times.",
    ),
  ).toBeTruthy();
});
it("rebinds the observer when the first day changes and resizes narrow vs roomy", () => {
  const daysA = [
    "2026-11-15",
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-21",
  ];
  const daysB = [
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-21",
    "2026-11-22",
  ];
  const overlap = [
    event("life-a", 60, 16 * 60),
    event("life-b", 60, 16 * 60),
    event("life-c", 60, 16 * 60),
  ];
  const { container, rerender } = renderCalendar(overlap, daysA);
  expect(observers).toHaveLength(1);
  const oldTrack = observers[0]!.targets[0];
  expect(oldTrack).toBeTruthy();

  rerender(
    <OwnerCalendar
      events={overlap}
      days={daysB}
      selectedDate={DAY}
      todayDate={DAY}
      view="week"
      labels={{ batch: "Session", booking: "Booking" }}
      empty={{ title: "No sessions", body: "None." }}
    />,
  );
  expect(observers).toHaveLength(2);
  expect(observers[0]!.active).toBe(false);
  const newTrack = observers[1]!.targets[0];
  expect(newTrack).toBeTruthy();
  expect(newTrack).not.toBe(oldTrack);

  act(() => observers[1]!.fire(100));
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="calendar-event"]'),
  );
  for (const block of blocks) {
    expect(block.tagName).toBe("DIV");
  }
  expect(screen.getByTestId("calendar-short-events")).toBeTruthy();
});
