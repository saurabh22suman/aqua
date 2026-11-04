// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ permissions: new Set(["reports.operational", "staff.attendance"]), cookie: "", terminology: { locale: "en", overrides: {} } as { locale: "en"; overrides: Record<string, unknown> }, members: vi.fn(), staff: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ permissions: state.permissions }), requirePagePermission: (ctx: { permissions: Set<string> }, key: string) => { if (!ctx.permissions.has(key)) throw new Error("forbidden " + key); } }));
vi.mock("@/lib/services/owner-people-reports", () => ({ getMembersReport: state.members, getStaffReport: state.staff }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => state.terminology }));
import MembersReportPage from "@/app/(owner)/owner/reports/members/page";
import StaffReportPage from "@/app/(owner)/owner/reports/staff/page";
afterEach(() => { cleanup(); vi.clearAllMocks(); state.cookie = ""; state.terminology = { locale: "en", overrides: {} }; state.permissions = new Set(["reports.operational", "staff.attendance"]); });

it("renders the member snapshot and real joined data with a last-seven-days default", async () => {
  state.members.mockResolvedValue({ statuses: [{ status: "active", count: 4 }], joined: 1, joinedUnknown: 1, joinedByDay: [{ date: "2026-10-10", count: 1 }] });
  render(await MembersReportPage({}));
  expect(screen.getByRole("heading", { name: "Members report" })).toBeTruthy();
  expect(screen.getByText(/current status/i)).toBeTruthy();
  expect(screen.getByLabelText("Range")).toHaveProperty("value", "last7");
  expect(state.members).toHaveBeenCalledOnce();
});

it("uses the club's member and facility vocabulary on both reports", async () => {
  state.terminology = { locale: "en", overrides: { member: { en: { one: "swimmer", other: "swimmers" } }, facility: { en: { one: "lane", other: "lanes" } } } };
  state.members.mockResolvedValue({ statuses: [], joined: 0, joinedUnknown: 0, joinedByDay: [] });
  state.staff.mockResolvedValue({ attendance: [], shifts: [] });
  render(await MembersReportPage({}));
  expect(screen.getByRole("heading", { name: "Swimmers report" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "New swimmers by day" })).toBeTruthy();
  expect(screen.getByText("No swimmers in this scope.")).toBeTruthy();
  expect(screen.getByText("No recorded joins for swimmers in this range.")).toBeTruthy();
  cleanup();
  render(await StaffReportPage({}));
  expect(screen.getByText(/unrestricted all lanes view/i)).toBeTruthy();
});

it.each(["members", "staff"] as const)("does not turn a %s read error into empty data", async (kind) => {
  const fn = kind === "members" ? state.members : state.staff;
  fn.mockRejectedValueOnce(new Error("read failed"));
  await expect((kind === "members" ? MembersReportPage : StaffReportPage)({})).rejects.toThrow("read failed");
});

it("gates the staff report independently before reading", async () => {
  state.permissions = new Set(["reports.operational"]);
  await expect(StaffReportPage({})).rejects.toThrow(/staff.attendance/);
  expect(state.staff).not.toHaveBeenCalled();
});

it("identifies unassigned attendance without calling it absent", async () => {
  state.staff.mockResolvedValue({ attendance: [{ date: "2026-10-10", status: "present", locationId: null, checkedIn: true }], shifts: [] });
  render(await StaffReportPage({}));
  expect(screen.getByText(/unassigned records: 1/i)).toBeTruthy();
  expect(screen.getByText(/unrecorded is not absence/i)).toBeTruthy();
});

it("reports empty check-ins and shifts without treating missing attendance as absence", async () => {
  state.staff.mockResolvedValue({ attendance: [], shifts: [] });
  render(await StaffReportPage({}));
  expect(screen.getByText("No recorded check-ins in this range.")).toBeTruthy();
  expect(screen.getByText("No shifts in this range.")).toBeTruthy();
  expect(screen.getByText(/unrecorded is not absence/i)).toBeTruthy();
  expect(screen.queryByRole("img", { name: /check-ins by day/i })).toBeNull();
});

it("preserves the requested period and gives URL facility precedence over the cookie", async () => {
  state.cookie = "11111111-1111-4111-8111-111111111111";
  state.staff.mockResolvedValue({ attendance: [], shifts: [] });
  render(await StaffReportPage({ searchParams: Promise.resolve({ period: "month", facility: "22222222-2222-4222-8222-222222222222" }) }));
  expect(screen.getByLabelText("Range")).toHaveProperty("value", "month");
  expect(state.staff).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ locationId: "22222222-2222-4222-8222-222222222222" }));
  expect(document.querySelector('input[name="facility"]')?.getAttribute("value")).toBe("22222222-2222-4222-8222-222222222222");
});

it("preserves explicit all facilities over a stale facility cookie when applying the range", async () => {
  state.cookie = "11111111-1111-4111-8111-111111111111";
  state.staff.mockResolvedValue({ attendance: [], shifts: [] });
  render(await StaffReportPage({ searchParams: Promise.resolve({ facility: "all" }) }));
  expect(state.staff).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ locationId: undefined }));
  expect(document.querySelector('input[name="facility"]')?.getAttribute("value")).toBe("all");
});

it.each(["members", "staff"] as const)("keeps explicit facility scope in the %s back link", async (kind) => {
  state.cookie = "11111111-1111-4111-8111-111111111111";
  state.staff.mockResolvedValue({ attendance: [], shifts: [] });
  state.members.mockResolvedValue({ statuses: [], joined: 0, joinedUnknown: 0, joinedByDay: [] });
  const page = kind === "members" ? MembersReportPage : StaffReportPage;
  for (const facility of ["22222222-2222-4222-8222-222222222222", "all"]) {
    render(await page({ searchParams: Promise.resolve({ facility }) }));
    expect(screen.getByRole("link", { name: /all reports/i }).getAttribute("href")).toBe(`/owner/reports?facility=${facility}`);
    cleanup();
  }
});
