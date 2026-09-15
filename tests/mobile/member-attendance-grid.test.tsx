// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberAttendanceGrid } from "@/components/member-detail/member-attendance-grid";
import type { AttendanceGridRow } from "@/lib/attendance-grid";

// C-27 redesign (2026-09-15) — the 15-day member attendance grid:
// summary, status-coloured cells, today's outline, and the tap-open
// day detail. Read-only by construction (no mutation controls).

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

function row(
  sessionDate: string,
  status: AttendanceGridRow["status"],
  overrides: Partial<AttendanceGridRow> = {},
): AttendanceGridRow {
  return {
    sessionId: `s-${sessionDate}`,
    sessionDate,
    batchName: "Morning Squad",
    status,
    markedAt: `${sessionDate}T02:30:00.000Z`,
    ...overrides,
  };
}

const TODAY = "2026-09-15";

const ROWS: AttendanceGridRow[] = [
  row("2026-09-15", "present"),
  row("2026-09-14", "late"),
  row("2026-09-13", "absent"),
  row("2026-09-12", "present"),
  row("2026-09-11", "present"),
  row("2026-09-10", "absent"),
];

afterEach(cleanup);

describe("MemberAttendanceGrid", () => {
  it("shows the summary: percentage and sessions attended", () => {
    render(<MemberAttendanceGrid rows={ROWS} today={TODAY} />);
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText("4 of 6 sessions attended")).toBeTruthy();
    expect(screen.getByText("Last 15 days")).toBeTruthy();
  });

  it("renders a cell per day with a status accessible name", () => {
    render(<MemberAttendanceGrid rows={ROWS} today={TODAY} />);
    expect(
      screen.getByRole("button", { name: "15 Sept 2026, present, today" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "14 Sept 2026, late" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "13 Sept 2026, absent" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "1 Sept 2026, no session" }),
    ).toBeTruthy();
  });

  it("marks today with aria-current", () => {
    render(<MemberAttendanceGrid rows={ROWS} today={TODAY} />);
    const today = screen.getByRole("button", {
      name: "15 Sept 2026, present, today",
    });
    expect(today.getAttribute("aria-current")).toBe("date");
  });

  it("opens a day's session detail on tap", () => {
    render(<MemberAttendanceGrid rows={ROWS} today={TODAY} />);
    expect(screen.getByText(/Tap a day/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "13 Sept 2026, absent" }),
    );
    expect(screen.getByText("13 Sept 2026")).toBeTruthy();
    expect(screen.getByText("Morning Squad")).toBeTruthy();
    expect(screen.getByText("absent")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "1 Sept 2026, no session" }),
    );
    expect(screen.getByText("No session marked this day.")).toBeTruthy();
  });

  it("lists every session when a day has more than one", () => {
    const rows = [
      row("2026-09-15", "present", {
        sessionId: "s-morning",
        batchName: "Morning Squad",
      }),
      row("2026-09-15", "absent", {
        sessionId: "s-evening",
        batchName: "Evening Squad",
      }),
    ];
    render(<MemberAttendanceGrid rows={rows} today={TODAY} />);
    fireEvent.click(
      screen.getByRole("button", { name: "15 Sept 2026, absent, today" }),
    );
    expect(screen.getByText("Morning Squad")).toBeTruthy();
    expect(screen.getByText("Evening Squad")).toBeTruthy();
  });

  it("links to the register only when a base path is given", () => {
    const rows = [row("2026-09-15", "present", { sessionId: "s-15" })];
    const { unmount } = render(
      <MemberAttendanceGrid rows={rows} today={TODAY} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "15 Sept 2026, present, today" }),
    );
    expect(screen.queryByRole("link", { name: "Register" })).toBeNull();
    unmount();

    render(
      <MemberAttendanceGrid
        rows={rows}
        today={TODAY}
        registerBasePath="/coach/register"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "15 Sept 2026, present, today" }),
    );
    const link = screen.getByRole("link", { name: "Register" });
    expect(link.getAttribute("href")).toBe("/coach/register/s-15");
  });

  it("shows the scope note when provided (coach view)", () => {
    render(
      <MemberAttendanceGrid
        rows={ROWS}
        today={TODAY}
        scopeNote="Counts only sessions from batches you coach."
      />,
    );
    expect(
      screen.getByText("Counts only sessions from batches you coach."),
    ).toBeTruthy();
  });

  it("has no mutation controls — the grid is read-only", () => {
    render(<MemberAttendanceGrid rows={ROWS} today={TODAY} />);
    expect(screen.queryByRole("button", { name: /mark|save|edit/i })).toBeNull();
  });
});
