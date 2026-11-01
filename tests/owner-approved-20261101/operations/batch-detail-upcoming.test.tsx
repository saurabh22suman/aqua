// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  ctx: { tenantId: "tenant", roleKey: "owner", permissions: new Set(["attendance.read", "members.read"]), allLocations: false, locationIds: ["site"] },
  summary: vi.fn(), upcoming: vi.fn(), roster: vi.fn(),
}));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => state.ctx }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => state.ctx, requirePagePermission: vi.fn() }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: (ctx: typeof state.ctx, key: string) => ctx.permissions.has(key) }));
vi.mock("@/db/tenant", () => ({ withTenant: async () => [{timezone: "Asia/Kolkata"}] }));
vi.mock("@/lib/services/attendance-history", () => ({ currentMonthPeriod: () => ({from: "2026-11-01", to: "2026-12-01"}), getBatchAttendanceSummary: state.summary }));
vi.mock("@/lib/services/coach-schedule", () => ({ listUpcomingSessions: state.upcoming }));
vi.mock("@/lib/services/register", () => ({ getRosterForSession: state.roster }));
vi.mock("@/lib/actions/waitlist", () => ({ listWaitlistAction: async () => [] }));
vi.mock("@/lib/actions/programs", () => ({ listBatchesAction: async () => [] }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({locale: "en", overrides: {}}) }));
vi.mock("@/components/waitlist-board", () => ({ WaitlistBoard: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import Page from "@/app/(owner)/owner/batches/[batchId]/page";

const renderPage = async () => renderToStaticMarkup(await Page({params: Promise.resolve({batchId: "batch"})}));
const row = (id: string, batchId: string, start: string, end: string) => ({id, batchId, sessionDate: "2026-11-02", startsAt: new Date(start), endsAt: new Date(end), coachName: "Coach A", status: "scheduled"});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T06:00:00Z"));
  state.ctx.permissions = new Set(["attendance.read", "members.read"]);
  state.summary.mockReset().mockResolvedValue({batchName: "Swimming", pct: null, sessionCount: 0});
  state.upcoming.mockReset().mockResolvedValue([]); state.roster.mockReset();
});
afterEach(() => vi.useRealTimers());
it("shows only this batch's next actual session and its roster, with owner links and real time", async () => {
  state.upcoming.mockResolvedValue([row("other", "other", "2026-11-02T01:30:00Z", "2026-11-02T02:00:00Z"), row("next", "batch", "2026-11-02T02:30:00Z", "2026-11-02T03:00:00Z")]);
  state.roster.mockResolvedValue({rows: [{memberId:"m1",name:"Asha",code:"M01",pct:99}]});
  const html = await renderPage();
  expect(state.upcoming).toHaveBeenCalledWith(state.ctx, "2026-11-01", "2026-11-30");
  expect(state.roster).toHaveBeenCalledWith(state.ctx, "next");
  expect(html).toContain("Next session roster"); expect(html).toContain("Asha");
  expect(html).toContain("/owner/members/m1"); expect(html).toContain("/owner/schedule?");
  expect(html).toMatch(/8:00\s*(am|AM)/); expect(html).toMatch(/8:30\s*(am|AM)/);
  expect(html).not.toContain("99%");
});
it("does not read sessions or roster without attendance permission or for an unavailable batch", async () => {
  state.ctx.permissions.delete("attendance.read"); await renderPage();
  expect(state.upcoming).not.toHaveBeenCalled(); expect(state.roster).not.toHaveBeenCalled();
  state.ctx.permissions.add("attendance.read"); state.summary.mockResolvedValue(null);
  await expect(renderPage()).rejects.toThrow("NOT_FOUND"); expect(state.upcoming).not.toHaveBeenCalled();
});
it("distinguishes no upcoming session from an empty roster", async () => {
  const html = await renderPage(); expect(html).toMatch(/no upcoming sessions/i);
  expect(state.roster).not.toHaveBeenCalled(); expect(html).not.toContain("Next session roster");
});
it("omits ended and cancelled sessions, limits the display, and keeps ungranted names unlinked", async () => {
  state.ctx.permissions.delete("members.read");
  const next = row("next", "batch", "2026-11-02T02:30:00Z", "2026-11-02T03:00:00Z");
  state.upcoming.mockResolvedValue([
    row("ended", "batch", "2026-11-01T01:00:00Z", "2026-11-01T02:00:00Z"),
    {...next, id: "cancelled", status: "cancelled"}, next,
    {...next, id: "two", coachName: "Coach Two"}, {...next, id: "three", coachName: "Coach Three"}, {...next, id: "four", coachName: "Coach Four"},
  ]);
  state.roster.mockResolvedValue({rows: [{memberId:"m1",name:"Asha",code:"M01"}]});
  const html = await renderPage();
  expect(state.roster).toHaveBeenCalledWith(state.ctx, "next");
  expect(html).toContain("Asha"); expect(html).not.toContain("/owner/members/m1");
  expect(html).toContain("Coach Three"); expect(html).not.toContain("Coach Four");
});
it("distinguishes read errors and a genuinely empty next roster", async () => {
  state.upcoming.mockRejectedValueOnce(new Error("unavailable"));
  expect(await renderPage()).toMatch(/upcoming sessions could not be loaded/i);
  state.upcoming.mockResolvedValue([row("next", "batch", "2026-11-02T02:30:00Z", "2026-11-02T03:00:00Z")]);
  state.roster.mockRejectedValueOnce(new Error("unavailable"));
  expect(await renderPage()).toMatch(/roster could not be loaded/i);
  state.roster.mockResolvedValueOnce({rows: []});
  expect(await renderPage()).toMatch(/no members on the next session roster/i);
});
