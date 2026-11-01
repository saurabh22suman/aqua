// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  owner: vi.fn(), attendance: vi.fn(), cookie: "", permissions: new Set<string>(), features: new Set<string>(),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("denied"); } }));
vi.mock("@/lib/auth/surface-guard", async original => ({ ...await original<typeof import("@/lib/auth/surface-guard")>(), requireOwner: state.owner }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@/lib/actions/owner-insights", () => ({ getOwnerInsightsAttendanceAction: state.attendance }));
import AttendancePage from "@/app/(owner)/owner/reports/attendance/page";

const facility = "11111111-1111-4111-8111-111111111111";
const otherFacility = "22222222-2222-4222-8222-222222222222";
const register = { sessionsWithRoster: 2, completedRegisters: 1, completionPct: 50, rosterSlots: 12, markedSlots: 10, unmarkedSlots: 2 };
const marks = { present: 6, late: 2, absent: 2, total: 10 };
const shares = { present: 60, late: 20, absent: 20 };
const data = { from: "2026-10-26", to: "2026-11-02", summary: { sessions: 2, marks, shares, register }, rows: [{ batchId: "a", batchName: "Morning swim", programName: "Swim", locationId: facility, sessions: 2, marks, shares, register }] };
const params = (value: { from?: string; to?: string; facility?: string; period?: string } = {}) => ({ searchParams: Promise.resolve(value) });

beforeEach(() => {
  state.permissions.clear(); state.permissions.add("reports.operational");
  state.features.clear(); state.features.add("reports");
  state.owner.mockReset().mockImplementation(async () => ({ permissions: state.permissions, features: state.features }));
  state.attendance.mockReset().mockResolvedValue(data);
  state.cookie = "";
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("checks operational page permission before the report query", async () => {
  state.permissions.clear();
  await expect(AttendancePage(params())).rejects.toThrow("denied");
  expect(state.attendance).not.toHaveBeenCalled();
});

it("defaults to seven dates including today and respects URL facility before cookie", async () => {
  state.cookie = otherFacility;
  render(await AttendancePage(params({ facility })));
  expect(state.attendance).toHaveBeenCalledWith({ from: "2026-10-26", to: "2026-11-02", locationId: facility });
  expect(screen.getByRole("heading", { name: "Attendance report" })).toBeTruthy();
});

it("uses cookie facility and converts an inclusive custom end date to exclusive", async () => {
  state.cookie = facility;
  render(await AttendancePage(params({ from: "2026-10-01", to: "2026-10-07" })));
  expect(state.attendance).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-08", locationId: facility });
});

it.each([["day", "2026-11-01"], ["week", "2026-10-26"], ["month", "2026-11-01"]])("uses the resolved %s preset", async (period, from) => {
  render(await AttendancePage(params({ period })));
  expect(state.attendance).toHaveBeenCalledWith({ from, to: "2026-11-02" });
});

it("does not start a read if reports are not entitled", async () => {
  state.features.clear();
  render(await AttendancePage(params()));
  expect(state.attendance).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/unavailable/i);
});

it.each([{ from: "2026-02-30", to: "2026-03-01" }, { from: "2026-10-08", to: "2026-10-01" }, { from: "2026-10-01" }, { period: "invalid" }, { period: "day", from: "bad", to: "2026-10-01" }])("rejects invalid or incomplete dates without querying: %j", async range => {
  render(await AttendancePage(params(range)));
  expect(state.attendance).not.toHaveBeenCalled();
  expect(screen.getByText(/Invalid date range/).getAttribute("role")).toBe("alert");
});

it("reports recorded marks accurately, includes late in attendance and keeps missing marks unknown", async () => {
  render(await AttendancePage(params()));
  expect(screen.getByText("80%")).toBeTruthy();
  expect(screen.getByText(/2 unmarked/i)).toBeTruthy();
  expect(screen.getAllByText("Morning swim").length).toBeGreaterThan(0);
  expect(screen.getByText(/6 present/i)).toBeTruthy();
  expect(screen.getByText(/2 late/i)).toBeTruthy();
  expect(screen.getByText(/2 absent/i)).toBeTruthy();
});

it("does not treat no marks as zero attendance", async () => {
  state.attendance.mockResolvedValue({ ...data, summary: { ...data.summary, marks: { present: 0, late: 0, absent: 0, total: 0 }, shares: { present: null, late: null, absent: null } } });
  render(await AttendancePage(params()));
  expect(screen.getByText(/no attendance marks/i)).toBeTruthy();
  expect(screen.queryByText("0%")).toBeNull();
});

it("shows an explicit read error, not an empty or zero result", async () => {
  state.attendance.mockRejectedValue(new Error("read failed"));
  render(await AttendancePage(params()));
  expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
  expect(screen.queryByText(/no attendance marks/i)).toBeNull();
});

it("distinguishes no roster from an incomplete register", async () => {
  state.attendance.mockResolvedValue({ ...data, rows: [], summary: { ...data.summary, sessions: 0, register: { sessionsWithRoster: 0, completedRegisters: 0, completionPct: null, rosterSlots: 0, markedSlots: 0, unmarkedSlots: 0 } } });
  render(await AttendancePage(params()));
  expect(screen.getByText(/no registers with a roster/i)).toBeTruthy();
  expect(screen.getByText(/no sessions in this range/i)).toBeTruthy();
});

it("submits the actual custom date-only values and the resolved facility", async () => {
  state.cookie = facility;
  render(await AttendancePage(params({ period: "custom", from: "2026-10-01", to: "2026-10-07" })));
  const form = screen.getByRole("button", { name: "Apply" }).closest("form");
  expect(form).not.toBeNull();
  const submitted = new FormData(form!);
  expect(Object.fromEntries(submitted)).toEqual({ period: "custom", from: "2026-10-01", to: "2026-10-07", facility });
  expect(screen.getByLabelText("From").getAttribute("type")).toBe("text");
});

it.each([["all", undefined], [otherFacility, otherFacility]])("retains explicit %s rather than a stale cookie when applying preset and custom ranges", async (scope, expectedLocation) => {
  state.cookie = facility;
  render(await AttendancePage(params({ facility: scope })));
  expect(state.attendance).toHaveBeenCalledWith({ from: "2026-10-26", to: "2026-11-02", ...(expectedLocation ? { locationId: expectedLocation } : {}) });
  const form = screen.getByRole("button", { name: "Apply" }).closest("form")!;
  fireEvent.change(screen.getByLabelText("Range"), { target: { value: "week" } });
  expect(Object.fromEntries(new FormData(form))).toEqual({ period: "week", facility: scope });
  fireEvent.change(screen.getByLabelText("Range"), { target: { value: "custom" } });
  const custom = Object.fromEntries(new FormData(form));
  expect(custom).toEqual({ period: "custom", from: "2026-10-26", to: "2026-11-01", facility: scope });
  state.attendance.mockClear();
  await AttendancePage(params({ period: String(custom.period), from: String(custom.from), to: String(custom.to), facility: String(custom.facility) }));
  expect(state.attendance).toHaveBeenCalledWith({ from: "2026-10-26", to: "2026-11-02", ...(expectedLocation ? { locationId: expectedLocation } : {}) });
});

it.each(["all", otherFacility])("retains explicit %s on Back to Reports despite a stale cookie", async scope => {
  state.cookie = facility;
  render(await AttendancePage(params({ facility: scope })));
  expect(screen.getByRole("link", { name: /all reports/i }).getAttribute("href")).toBe(`/owner/reports?facility=${scope}`);
});
