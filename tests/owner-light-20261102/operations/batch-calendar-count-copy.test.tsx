// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Owner light · Operations lane (3 November 2026) — the batch page's
// calendar-count line.
//
// getBatchAttendanceSummary counts EVERY sessions row in the month — future
// and cancelled rows included — so the number is a CALENDAR quantity, not
// proof that classes ran or were held. The visible RED is the combined Chrome
// screenshot (`…/owner-light-independent-visual-r7/batch-card-height/
// lavender-1280-batch.png`), where 3 Nov says "24 sessions ran this month".
//
// The copy states the calendar fact and nothing more; the methodology
// sentence does not belong repeated on this line. The percentage and the
// marked numerator/denominator are untouched and are asserted as controls.

const state = vi.hoisted(() => ({
  ctx: {
    tenantId: "tenant",
    roleKey: "owner",
    permissions: new Set(["attendance.read", "members.read"]),
    allLocations: false,
    locationIds: ["site"],
  },
  summary: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => state.ctx }));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => state.ctx,
  requirePagePermission: vi.fn(),
}));
vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (ctx: typeof state.ctx, key: string) =>
    ctx.permissions.has(key),
}));
vi.mock("@/db/tenant", () => ({ withTenant: async () => [{ timezone: "Asia/Kolkata" }] }));
vi.mock("@/lib/services/attendance-history", () => ({
  currentMonthPeriod: () => ({ from: "2026-11-01", to: "2026-12-01" }),
  getBatchAttendanceSummary: state.summary,
}));
vi.mock("@/lib/services/coach-schedule", () => ({ listUpcomingSessions: async () => [] }));
vi.mock("@/lib/services/register", () => ({ getRosterForSession: vi.fn() }));
vi.mock("@/lib/actions/waitlist", () => ({ listWaitlistAction: async () => [] }));
vi.mock("@/lib/actions/programs", () => ({ listBatchesAction: async () => [] }));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));
vi.mock("@/components/waitlist-board", () => ({ WaitlistBoard: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import Page from "@/app/(owner)/owner/batches/[batchId]/page";

const renderPage = async () =>
  renderToStaticMarkup(
    await Page({ params: Promise.resolve({ batchId: "batch" }) }),
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T06:00:00Z"));
  state.ctx.permissions = new Set(["attendance.read", "members.read"]);
  state.summary.mockReset().mockResolvedValue({
    batchName: "Swimming",
    pct: null,
    sessionCount: 0,
  });
});
afterEach(() => vi.useRealTimers());

it("states the calendar count without claiming the classes ran", async () => {
  // A month whose row count includes future and cancelled calendar entries.
  state.summary.mockResolvedValue({
    batchName: "Swimming",
    pct: null,
    sessionCount: 24,
  });

  const html = await renderPage();

  expect(html).toContain("24 sessions on the calendar.");
  // The old wording asserted something the read cannot prove.
  expect(html).not.toMatch(/ran this month/i);
  expect(html).not.toMatch(/held/i);
  // The methodology sentence is not repeated on this line.
  expect(html).not.toContain(
    "Register completion and scheduled sessions are separate measures",
  );
});

it("uses the singular for one calendar session and the zero wording for none", async () => {
  state.summary.mockResolvedValue({
    batchName: "Swimming",
    pct: null,
    sessionCount: 1,
  });
  const one = await renderPage();
  expect(one).toContain("1 session on the calendar.");

  state.summary.mockResolvedValue({
    batchName: "Swimming",
    pct: null,
    sessionCount: 0,
  });
  const none = await renderPage();
  expect(none).toContain("No sessions on the calendar this month.");
  expect(none).not.toMatch(/ran this month/i);
  expect(none).not.toContain("No sessions have run");
});

it("keeps the percentage and the marked numerator and denominator unchanged", async () => {
  state.summary.mockResolvedValue({
    batchName: "Swimming",
    pct: 80,
    presentMarks: 8,
    totalMarks: 10,
    sessionCount: 24,
  });

  const html = await renderPage();

  expect(html).toContain("80%");
  expect(html).toContain("8 Present or Late out of 10");
  expect(html).toContain("recorded marks");
  // The count is still stated, and still only as a calendar quantity.
  expect(html).toContain("24 sessions on the calendar.");
});

it("keeps the page's own permission control", async () => {
  // The upcoming/roster block is the attendance-gated surface on this page;
  // the marks the page is allowed to read are unaffected by removing the
  // grant. (The count line's own contract is covered above.)
  state.ctx.permissions.delete("attendance.read");
  state.summary.mockResolvedValue({
    batchName: "Swimming",
    pct: 80,
    presentMarks: 8,
    totalMarks: 10,
    sessionCount: 24,
  });

  const html = await renderPage();

  expect(html).not.toContain("Upcoming sessions");
  expect(html).not.toContain("Next session roster");
  expect(html).toContain("80%");
});
