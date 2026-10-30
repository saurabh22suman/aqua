// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

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

const DAYS = [
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
  "2026-11-02",
  "2026-11-03",
];

function event(
  overrides: Partial<CalendarEvent> & { id: string },
): CalendarEvent {
  return {
    category: "batch",
    title: "Holiday Recovery",
    date: "2026-10-28",
    startsAt: "2026-10-28T23:30:00+05:30",
    endsAt: "2026-10-29T00:30:00+05:30",
    startMinutes: 23 * 60 + 30,
    durationMinutes: 60,
    status: "scheduled",
    detail: [],
    ...overrides,
  };
}

afterEach(cleanup);

it("offers a 44px jump to working hours while keeping the overnight block", () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const { container } = render(
    <OwnerCalendar
      events={[event({ id: "e1" })]}
      days={DAYS}
      selectedDate="2026-10-29"
      todayDate="2026-10-29"
      view="week"
      labels={{ batch: "Session", booking: "Booking" }}
      empty={{ title: "No sessions", body: "None." }}
    />,
  );

  const jump = screen.getByRole("button", { name: "Jump to working hours" });
  expect(jump.className).toContain("min-h-11");
  expect(screen.getByTestId("calendar-working-start")).toBeTruthy();

  const dayTrack = container.querySelector<HTMLElement>(
    '[data-testid="calendar-track"][data-date="2026-10-29"]',
  );
  const continuation = Array.from(
    dayTrack?.querySelectorAll<HTMLElement>('[data-testid="calendar-event"]') ?? [],
  ).find((block) => block.getAttribute("data-height") === "30");
  expect(continuation).toBeTruthy();

  fireEvent.click(jump);
  expect(scrollIntoView).toHaveBeenCalled();
});

it("keeps true duration and side-by-side overlap for the midnight event", () => {
  const { container } = render(
    <OwnerCalendar
      events={[
        event({ id: "e1" }),
        event({
          id: "e2",
          title: "Late Squad",
          date: "2026-10-29",
          startsAt: "2026-10-29T00:00:00+05:30",
          endsAt: "2026-10-29T01:00:00+05:30",
          startMinutes: 0,
          durationMinutes: 60,
        }),
      ]}
      days={DAYS}
      selectedDate="2026-10-29"
      todayDate="2026-10-29"
      view="week"
      labels={{ batch: "Session", booking: "Booking" }}
      empty={{ title: "No sessions", body: "None." }}
    />,
  );

  const dayTrack = container.querySelector<HTMLElement>(
    '[data-testid="calendar-track"][data-date="2026-10-29"]',
  );
  const continuation = Array.from(
    dayTrack?.querySelectorAll<HTMLElement>('[data-testid="calendar-event"]') ?? [],
  ).find((block) => block.getAttribute("data-height") === "30");
  expect(continuation?.getAttribute("data-columns")).toBe("2");
});

it("keeps the agenda alternative at a full 44px row target", () => {
  render(
    <OwnerCalendar
      events={[event({ id: "e1", startMinutes: 6 * 60, durationMinutes: 60 })]}
      days={["2026-10-28"]}
      selectedDate="2026-10-28"
      todayDate="2026-10-28"
      view="agenda"
      labels={{ batch: "Session", booking: "Booking" }}
      empty={{ title: "No sessions", body: "None." }}
    />,
  );
  const row = screen.getByTestId("calendar-agenda-item");
  expect(row.className).toContain("min-h-11");
});
