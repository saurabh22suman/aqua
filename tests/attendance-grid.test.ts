import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_GRID_DAYS,
  dayStatus,
  gridDays,
  gridWindow,
  rowsInWindow,
  summarise,
  type AttendanceGridRow,
} from "@/lib/attendance-grid";

// The member attendance grid's rules (2026-09-15 redesign): a 15-day
// window ending today, one cell per day, the worst mark of the day
// winning, late counting as attended.

function row(
  sessionDate: string,
  status: AttendanceGridRow["status"],
  overrides: Partial<AttendanceGridRow> = {},
): AttendanceGridRow {
  return {
    sessionId: `s-${sessionDate}-${status}`,
    sessionDate,
    batchName: "Morning Squad",
    status,
    markedAt: null,
    ...overrides,
  };
}

describe("gridWindow", () => {
  it("is the last 15 days, today last", () => {
    const window = gridWindow("2026-09-15");
    expect(window.from).toBe("2026-09-01");
    expect(window.to).toBe("2026-09-15");
  });

  it("crosses a month boundary", () => {
    const window = gridWindow("2026-10-05");
    expect(window.from).toBe("2026-09-21");
    expect(window.to).toBe("2026-10-05");
  });
});

describe("rowsInWindow", () => {
  it("keeps only rows inside the window", () => {
    const rows = [
      row("2026-08-31", "present"),
      row("2026-09-01", "present"),
      row("2026-09-15", "absent"),
      row("2026-09-16", "present"),
    ];
    const kept = rowsInWindow(rows, "2026-09-15");
    expect(kept.map((r) => r.sessionDate)).toEqual([
      "2026-09-01",
      "2026-09-15",
    ]);
  });
});

describe("dayStatus", () => {
  it("is none with no sessions", () => {
    expect(dayStatus([])).toBe("none");
  });

  it("lets the worst mark of the day win", () => {
    expect(dayStatus([{ status: "present" }])).toBe("present");
    expect(dayStatus([{ status: "present" }, { status: "late" }])).toBe("late");
    expect(dayStatus([{ status: "present" }, { status: "absent" }])).toBe(
      "absent",
    );
    expect(dayStatus([{ status: "late" }, { status: "absent" }])).toBe(
      "absent",
    );
  });
});

describe("summarise", () => {
  it("counts late as attended and rounds the percentage", () => {
    const rows = [
      row("2026-09-15", "present"),
      row("2026-09-14", "late"),
      row("2026-09-13", "absent"),
      row("2026-09-12", "present"),
      row("2026-09-11", "present"),
      row("2026-09-10", "absent"),
    ];
    expect(summarise(rows)).toEqual({
      presentCount: 4,
      totalCount: 6,
      pct: 67,
    });
  });

  it("has no percentage with no marked sessions", () => {
    expect(summarise([])).toEqual({
      presentCount: 0,
      totalCount: 0,
      pct: null,
    });
  });
});

describe("gridDays", () => {
  it("always renders 15 days, oldest first, today flagged", () => {
    const days = gridDays([], "2026-09-15");
    expect(days).toHaveLength(ATTENDANCE_GRID_DAYS);
    expect(days[0]?.date).toBe("2026-09-01");
    expect(days[14]?.date).toBe("2026-09-15");
    expect(days[14]?.isToday).toBe(true);
    expect(days.filter((d) => d.isToday)).toHaveLength(1);
    expect(days.every((d) => d.status === "none")).toBe(true);
  });

  it("keeps every session of a multi-session day for the detail", () => {
    const days = gridDays(
      [
        row("2026-09-15", "present", { batchName: "Morning Squad" }),
        row("2026-09-15", "absent", { batchName: "Evening Squad" }),
      ],
      "2026-09-15",
    );
    const today = days[14]!;
    expect(today.status).toBe("absent");
    expect(today.rows.map((r) => r.batchName)).toEqual([
      "Morning Squad",
      "Evening Squad",
    ]);
  });

  it("drops rows outside the window", () => {
    const days = gridDays([row("2026-08-20", "present")], "2026-09-15");
    expect(days.every((d) => d.rows.length === 0)).toBe(true);
  });
});
