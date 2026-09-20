// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StaffAttendanceBoard } from "@/components/staff-attendance-board";
import type { StaffAttendanceDayRow } from "@/lib/services/staff-attendance";

// V-24 — the reception staff-attendance board. The load-bearing
// assertions: the permission gate (no mark controls when canMark is
// false) and the reason requirement (Confirm stays disabled until a
// reason is typed). Removing either turns this red.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/staff-attendance", () => ({
  correctStaffAttendanceAction: vi.fn(),
}));

afterEach(cleanup);

const ROWS: StaffAttendanceDayRow[] = [
  {
    staffId: "11111111-1111-7111-8111-111111111111",
    staffName: "Coach Late",
    staffType: "coach",
    shiftStartAt: "2026-09-20T00:30:00.000Z",
    shiftEndAt: "2026-09-20T04:30:00.000Z",
    status: "present",
    lateMinutes: 12,
    method: "self_app",
    checkedInAt: "2026-09-20T00:42:00.000Z",
    checkedOutAt: null,
    note: null,
  },
  {
    staffId: "22222222-2222-7222-8222-222222222222",
    staffName: "Desk Unmarked",
    staffType: "receptionist",
    shiftStartAt: null,
    shiftEndAt: null,
    status: null,
    lateMinutes: 0,
    method: null,
    checkedInAt: null,
    checkedOutAt: null,
    note: null,
  },
];

describe("StaffAttendanceBoard (V-24)", () => {
  it("lists the day's staff with their status and late minutes", () => {
    render(<StaffAttendanceBoard date="2026-09-20" rows={ROWS} canMark />);
    expect(screen.getByText("Coach Late")).toBeDefined();
    expect(screen.getByText(/12 min late/)).toBeDefined();
    expect(screen.getByText("Desk Unmarked")).toBeDefined();
    expect(screen.getByText("Not marked")).toBeDefined();
  });

  it("offers no mark controls without staff.attendance", () => {
    render(
      <StaffAttendanceBoard date="2026-09-20" rows={ROWS} canMark={false} />,
    );
    expect(screen.queryByRole("button", { name: "Present" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Absent" })).toBeNull();
  });

  it("requires a reason before a manual correction can be confirmed", () => {
    render(<StaffAttendanceBoard date="2026-09-20" rows={ROWS} canMark />);

    fireEvent.click(screen.getAllByRole("button", { name: "Present" })[1]!);
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "No login yet" }));
    expect(confirm).toHaveProperty("disabled", false);
  });
});
