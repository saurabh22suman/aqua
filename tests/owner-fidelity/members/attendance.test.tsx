// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemberAttendanceGrid } from "@/components/member-detail/member-attendance-grid";
import type { AttendanceGridRow } from "@/lib/attendance-grid";

afterEach(cleanup);
const rows: AttendanceGridRow[] = [
  { sessionId: "one", sessionDate: "2026-09-15", batchName: "Morning", status: "present", markedAt: null },
  { sessionId: "two", sessionDate: "2026-09-14", batchName: "Evening", status: "absent", markedAt: null },
];

it("shows actual marked-session counts and opens a day's real details", () => {
  render(<MemberAttendanceGrid rows={rows} today="2026-09-15" ownerCard />);
  expect(screen.getByText("50%")).toBeTruthy();
  expect(screen.getByText("1 of 2 marked sessions attended")).toBeTruthy();
  expect(screen.getByText("Last 15 days")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "14 Sept 2026, absent" }));
  expect(screen.getByText("Evening")).toBeTruthy();
});

it("shows unknown attendance when no sessions are marked", () => {
  render(<MemberAttendanceGrid rows={[]} today="2026-09-15" ownerCard />);
  expect(screen.getByText("—")).toBeTruthy();
  expect(screen.getByText("No sessions marked yet")).toBeTruthy();
});
