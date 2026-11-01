// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AttendanceTrendCard } from "@/components/reports/analytics-cards";
import {
  chartText,
  drawnLines,
  gridLines,
  plottedDots,
  rawDrawables,
  svgByLabel,
} from "./chart-dom";

// 30 October 2026 — owner report chart readability.
//
// The owner's report was unreadable: the Attendance trend card drew a
// bare line with no dates, no units and no scale, so the numbers in the
// card could not be checked against anything. These are the acceptance
// tests for the bounded readability fix: visible axes with the real
// units, the real dates, the exact per-day numbers in a table, and
// unrecorded days left as gaps rather than drawn as zero.
//
// The card's own arithmetic is not in scope and must not drift: the
// header stays the weighted present-of-total over every day.

afterEach(cleanup);

type Point = { date: string; present: number; total: number; pct: number | null };

const MIXED: Point[] = [
  { date: "2026-09-01", present: 12, total: 16, pct: 75 },
  { date: "2026-09-02", present: 14, total: 16, pct: 88 },
  // A session was held but no mark was written: unknown, not zero.
  { date: "2026-09-03", present: 0, total: 0, pct: null },
  { date: "2026-09-04", present: 8, total: 16, pct: 50 },
];

function chart() {
  return svgByLabel(/attendance percentage by day/i);
}

function rows(): string[][] {
  const table = document.querySelector("table");
  if (!table) throw new Error("the attendance card must carry an accessible data table");
  return Array.from(table.querySelectorAll("tbody tr")).map((row) =>
    Array.from(row.querySelectorAll("td")).map((cell) => (cell.textContent ?? "").trim()),
  );
}

function headers(): string[] {
  const table = document.querySelector("table");
  if (!table) throw new Error("the attendance card must carry an accessible data table");
  return Array.from(table.querySelectorAll("thead th")).map((cell) =>
    (cell.textContent ?? "").trim(),
  );
}

describe("attendance trend axes", () => {
  it("shows a zero-based 0-100% scale on the y axis", () => {
    render(<AttendanceTrendCard points={MIXED} />);
    const text = chartText(chart());
    expect(text).toContain("0%");
    expect(text).toContain("50%");
    expect(text).toContain("100%");
  });

  it("names the unit of the y axis", () => {
    render(<AttendanceTrendCard points={MIXED} />);
    expect(chartText(chart()).join(" ")).toMatch(/percent/i);
  });

  it("labels the x axis with the report's own dates", () => {
    render(<AttendanceTrendCard points={MIXED} />);
    const text = chartText(chart()).join(" ");
    expect(text).toMatch(/\b1 Sept?\b/);
    expect(text).toMatch(/\b4 Sept?\b/);
    expect(text).toMatch(/date/i);
  });

  it("states the period the trend covers", () => {
    render(<AttendanceTrendCard points={MIXED} />);
    expect(document.body.textContent).toMatch(/1 Sept? 2026/);
    expect(document.body.textContent).toMatch(/4 Sept? 2026/);
  });

  it("keeps the scale zero-based: 0% on the baseline, 100% on the top gridline", () => {
    render(
      <AttendanceTrendCard
        points={[
          { date: "2026-09-01", present: 0, total: 16, pct: 0 },
          { date: "2026-09-02", present: 16, total: 16, pct: 100 },
        ]}
      />,
    );
    const grid = gridLines(chart());
    expect(grid.length).toBeGreaterThanOrEqual(3);
    const top = Math.min(...grid);
    const bottom = Math.max(...grid);
    const dots = plottedDots(chart());
    expect(dots).toHaveLength(2);
    expect(dots.some((dot) => dot.y === bottom)).toBe(true);
    expect(dots.some((dot) => dot.y === top)).toBe(true);
  });
});

describe("attendance trend gaps", () => {
  it("never draws a line across a day with no recorded marks", () => {
    render(<AttendanceTrendCard points={MIXED} />);
    const lines = drawnLines(chart());
    // 1 Sep and 2 Sep are one run; 4 Sep is isolated after the gap.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(4);
  });

  it("leaves two separated days as two dots and no line", () => {
    render(
      <AttendanceTrendCard
        points={[
          { date: "2026-09-01", present: 12, total: 16, pct: 75 },
          { date: "2026-09-02", present: 0, total: 0, pct: null },
          { date: "2026-09-03", present: 8, total: 16, pct: 50 },
        ]}
      />,
    );
    expect(drawnLines(chart())).toHaveLength(0);
    expect(plottedDots(chart())).toHaveLength(2);
  });

  it("joins every segment to the two recorded days it belongs to, after a gap", () => {
    // A run that starts AFTER the first day: the second run begins at
    // the fourth day, so a segment that mixes the day's own position
    // with its place in the run ends up pointing at nothing.
    render(
      <AttendanceTrendCard
        points={[
          { date: "2026-09-01", present: 6, total: 10, pct: 60 },
          { date: "2026-09-02", present: 7, total: 10, pct: 70 },
          { date: "2026-09-03", present: 0, total: 0, pct: null },
          { date: "2026-09-04", present: 8, total: 10, pct: 80 },
          { date: "2026-09-05", present: 9, total: 10, pct: 90 },
        ]}
      />,
    );
    const dots = plottedDots(chart());
    const lines = drawnLines(chart());
    // Four recorded days (3 September has no mark) and two segments:
    // one inside each run.
    expect(dots).toHaveLength(4);
    expect(lines).toHaveLength(2);
    // Each segment must join two neighbouring recorded days, in the
    // order the days were reported.
    const pairs = lines.map(([x1, y1, x2, y2]) => [
      dots.findIndex((dot) => dot.x === x1 && dot.y === y1),
      dots.findIndex((dot) => dot.x === x2 && dot.y === y2),
    ]);
    expect(pairs).toEqual([
      [0, 1],
      [2, 3],
    ]);
    // No segment reaches across the unrecorded 3 September, and no
    // segment collapses onto the first day (a phantom line to zero).
    expect(pairs.some(([from, to]) => from === 1 && to === 2)).toBe(false);
    expect(lines.every(([x1, , x2]) => x1 !== dots[0]!.x || x2 !== dots[0]!.x)).toBe(
      true,
    );
  });

  it("never emits a path that starts with a line command", () => {
    render(
      <AttendanceTrendCard
        points={[
          { date: "2026-09-01", present: 0, total: 0, pct: null },
          { date: "2026-09-02", present: 12, total: 16, pct: 75 },
          { date: "2026-09-03", present: 8, total: 16, pct: 50 },
        ]}
      />,
    );
    for (const raw of rawDrawables(chart())) {
      expect(raw).not.toMatch(/^\s*L/i);
    }
    const lines = drawnLines(chart());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(4);
  });

  it("starts the line at the first recorded day, not at an unrecorded one", () => {
    render(
      <AttendanceTrendCard
        points={[
          { date: "2026-09-01", present: 0, total: 0, pct: null },
          { date: "2026-09-02", present: 12, total: 16, pct: 75 },
          { date: "2026-09-03", present: 8, total: 16, pct: 50 },
        ]}
      />,
    );
    const lines = drawnLines(chart());
    const dots = plottedDots(chart());
    expect(lines).toHaveLength(1);
    expect(dots).toHaveLength(2);
    // The segment starts where the first recorded day is plotted.
    expect(lines[0]?.[0]).toBe(dots[0]?.x);
  });

  it("says an unrecorded period is unknown instead of drawing an empty chart", () => {
    render(
      <AttendanceTrendCard
        points={[
          { date: "2026-09-01", present: 0, total: 0, pct: null },
          { date: "2026-09-02", present: 0, total: 0, pct: null },
        ]}
      />,
    );
    expect(document.querySelector("svg")).toBeNull();
    expect(document.body.textContent).toMatch(/unknown, not zero/i);
  });
});

describe("attendance trend data table", () => {
  it("carries the exact numbers for every day", () => {
    render(<AttendanceTrendCard points={MIXED} />);
    expect(headers()).toEqual([
      "Date",
      "Present or late",
      "Recorded marks",
      "Attendance",
    ]);
    const table = rows();
    expect(table).toHaveLength(4);
    expect(table[0]?.[0]).toMatch(/1 Sept? 2026/);
    expect(table[0]?.[1]).toBe("12");
    expect(table[0]?.[2]).toBe("16");
    expect(table[0]?.[3]).toBe("75%");
    expect(table[1]?.[3]).toBe("88%");
    expect(table[3]?.[3]).toBe("50%");
  });

  it("shows an unrecorded day as unknown, never as 0%", () => {
    render(<AttendanceTrendCard points={MIXED} />);
    const unrecorded = rows()[2];
    expect(unrecorded?.[0]).toMatch(/3 Sept? 2026/);
    expect(unrecorded?.[1]).toBe("0");
    expect(unrecorded?.[2]).toBe("0");
    expect(unrecorded?.[3]).not.toContain("%");
    expect(unrecorded?.[3]?.trim()).not.toBe("");
  });

  it("keeps the card's weighted header arithmetic", () => {
    render(<AttendanceTrendCard points={MIXED} />);
    // 34 present marks of 48 recorded marks across the period.
    expect(document.body.textContent).toMatch(/71% present/);
    expect(document.body.textContent).toMatch(/34 of 48/);
    // The numerator counts present OR late marks (the report's own
    // definition), so the summary says so. "71% present" would claim
    // something the report does not say. The arithmetic is unchanged.
    expect(document.body.textContent).toMatch(/71% present or late/);
  });
});
