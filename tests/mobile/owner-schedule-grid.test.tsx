// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// U-04 — the schedule grid. The week view renders seven stacked day
// sections (no `overflow-x-auto` anywhere), each session row shows
// the batch's capacity lane, and the month view adds the 7-column
// month strip. 44px controls: every nav link carries min-h-[44px].

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
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
import type { GridSessionRow } from "@/lib/services/schedule-grid";

const SESSION: GridSessionRow = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
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
};

const WEEK = [
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
  "2026-09-19",
  "2026-09-20",
];

afterEach(cleanup);

describe("U-04 schedule grid", () => {
  it("renders seven day sections and the session row's lane", () => {
    const { container } = render(
      <OwnerScheduleGrid
        view="week"
        locations={[{ id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "Worli" }]}
        sessions={[SESSION]}
        days={WEEK}
        monthCells={null}
        prevHref="/owner/schedule?date=2026-09-07"
        nextHref="/owner/schedule?date=2026-09-21"
        todayHref="/owner/schedule"
      />,
    );
    expect(container.querySelectorAll("section").length).toBe(7);
    expect(document.body.textContent).toContain("Junior 7am");
    expect(document.body.textContent).toContain("4 / 16");
    // The lane fill is warn (under 50%) — the design's under-filled
    // state, not a generic progress bar.
    expect(container.querySelector(".bg-warn")).toBeTruthy();
    expect(document.body.textContent).toContain("Riya Nair");
  });

  it("never introduces horizontal scroll at 390px", () => {
    const { container } = render(
      <OwnerScheduleGrid
        view="week"
        locations={[]}
        sessions={[SESSION]}
        days={WEEK}
        monthCells={null}
        prevHref="#"
        nextHref="#"
        todayHref="#"
      />,
    );
    expect(container.querySelectorAll(".overflow-x-auto").length).toBe(0);
    expect(container.querySelectorAll(".min-w-\\[520px\\]").length).toBe(0);
  });

  it("shows day-level empty states and the batch editor path when the week is empty", () => {
    render(
      <OwnerScheduleGrid
        view="week"
        locations={[]}
        sessions={[]}
        days={WEEK}
        monthCells={null}
        prevHref="#"
        nextHref="#"
        todayHref="#"
      />,
    );
    expect(document.body.textContent).toMatch(/no sessions scheduled in this week/i);
    const manage = Array.from(document.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Manage batches"),
    );
    expect(manage?.getAttribute("href")).toBe("/owner/programs");
  });

  it("renders the month strip with a count per day and 44px day cells", () => {
    const monthCells = WEEK.map((date, i) => ({
      date,
      inMonth: true,
      count: i === 0 ? 1 : 0,
    }));
    const { container } = render(
      <OwnerScheduleGrid
        view="month"
        locations={[]}
        sessions={[SESSION]}
        days={WEEK}
        monthCells={monthCells}
        prevHref="#"
        nextHref="#"
        todayHref="#"
      />,
    );
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll('a[href*="view=week&date="]').length).toBe(7);
    const cells = container.querySelectorAll("td a");
    expect(cells.length).toBe(7);
    expect((cells[0] as HTMLElement).className).toContain("min-h-[44px]");
  });

  it("offers the location filter only when more than one location exists", () => {
    const { rerender } = render(
      <OwnerScheduleGrid
        view="week"
        locations={[{ id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "Worli" }]}
        sessions={[SESSION]}
        days={WEEK}
        monthCells={null}
        prevHref="#"
        nextHref="#"
        todayHref="#"
      />,
    );
    expect(document.querySelector('select[name="location"]')).toBeNull();

    rerender(
      <OwnerScheduleGrid
        view="week"
        locations={[
          { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "Worli" },
          { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", name: "Andheri" },
        ]}
        sessions={[SESSION]}
        days={WEEK}
        monthCells={null}
        prevHref="#"
        nextHref="#"
        todayHref="#"
      />,
    );
    expect(document.querySelector('select[name="location"]')).toBeTruthy();
  });

describe("schedule desktop composition (PR3-C5)", () => {
  it("lays the week out in seven columns at desktop while stacked on phones", () => {
    const { container } = render(
      <OwnerScheduleGrid
        view="week"
        locations={[]}
        sessions={[SESSION]}
        days={WEEK}
        monthCells={null}
        prevHref="#"
        nextHref="#"
        todayHref="#"
      />,
    );
    const grid = container.querySelector("[class*='md:grid-cols-7']");
    expect(grid).not.toBeNull();
    expect(grid!.className).toContain("space-y-4");
  });
});
});
