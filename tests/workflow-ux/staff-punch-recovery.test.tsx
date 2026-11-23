// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MyAttendanceCard } from "@/components/my-attendance-card";

const mocks = vi.hoisted(() => ({ checkIn: vi.fn(), checkOut: vi.fn(), read: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/staff-attendance", () => ({
  selfCheckInAction: mocks.checkIn,
  selfCheckOutAction: mocks.checkOut,
  getMyAttendanceAction: mocks.read,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

class WorkdayBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>Workday interrupted</p> : this.props.children; }
}

const date = "2026-11-23";
const checkedIn = {
  id: "attendance", workDate: date, status: "present" as const, lateMinutes: 0,
  method: "self_app" as const, checkedInAt: "2026-11-23T03:30:00.000Z", checkedOutAt: null, note: null,
};

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("keeps the punch action focusable while waiting for the connection", async () => {
  let reject!: (error: Error) => void;
  mocks.checkIn.mockReturnValueOnce(new Promise((_resolve, failed) => { reject = failed; }));
  render(<MyAttendanceCard attendance={null} date={date} />);
  const punch = screen.getByRole<HTMLButtonElement>("button", { name: "Check in" });
  punch.focus();
  fireEvent.click(punch);
  const waitingState = { disabled: punch.disabled, ariaDisabled: punch.getAttribute("aria-disabled") };
  fireEvent.click(punch);
  await act(async () => reject(new Error("Connection lost")));
  expect(waitingState).toEqual({ disabled: false, ariaDisabled: "true" });
  expect(mocks.checkIn).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Check attendance" }));
});

it("moves keyboard focus to the attendance status when a lost checkout is confirmed", async () => {
  mocks.checkOut.mockRejectedValueOnce(new Error("Connection lost"));
  mocks.read.mockResolvedValueOnce({ ...checkedIn, checkedOutAt: "2026-11-23T11:30:00.000Z" });
  render(<MyAttendanceCard attendance={checkedIn} date={date} />);
  const checkOut = screen.getByRole("button", { name: "Check out" });
  checkOut.focus();
  await act(async () => fireEvent.click(checkOut));
  const check = screen.getByRole("button", { name: "Check attendance" });
  check.focus();
  await act(async () => fireEvent.click(check));
  const status = screen.getByRole("status");
  expect(status.textContent).toMatch(/Checked in .* · out /);
  expect(document.activeElement).toBe(status);
  expect(mocks.checkOut).toHaveBeenCalledTimes(1);
});

it.each([false, true])("checks authoritative attendance before any new punch when the request throws (committed: %s)", async (committed) => {
  mocks.checkIn.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ ok: true });
  mocks.read.mockResolvedValueOnce(committed ? checkedIn : null);
  render(<WorkdayBoundary><MyAttendanceCard attendance={null} date={date} /></WorkdayBoundary>);

  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check in" })));
  expect(screen.queryByText("Workday interrupted")).toBeNull();
  expect(screen.getByRole("alert").textContent).toMatch(/connection/i);
  expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check attendance" }));
  const next = await screen.findByRole("button", { name: committed ? "Check out" : "Check in" });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ date });
  expect(mocks.checkIn).toHaveBeenCalledTimes(1);
  if (committed) {
    expect(screen.getByText(/^Checked in /)).toBeTruthy();
    expect(mocks.checkOut).not.toHaveBeenCalled();
  } else {
    await act(async () => fireEvent.click(next));
    expect(mocks.checkIn).toHaveBeenCalledTimes(2);
  }
});
