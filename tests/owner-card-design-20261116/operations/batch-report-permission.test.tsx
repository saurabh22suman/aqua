// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ allowed: false, reports: true }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/context", () => ({ NotFoundError: class NotFoundError extends Error {}, requireDefaultCtx: async () => ({ tenantId: "tenant", permissions: new Set(["programs.read", ...(state.allowed ? ["reports.operational"] : [])]) }) }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: (ctx: { permissions: Set<string> }, key: string) => ctx.permissions.has(key), hasFeature: () => state.reports }));
vi.mock("@/db/tenant", () => ({ withTenant: async () => [{ timezone: "Asia/Kolkata" }] }));
vi.mock("@/lib/services/attendance-history", () => ({ currentMonthPeriod: () => ({ from: "2026-11-01", to: "2026-12-01" }), getBatchAttendanceSummary: async () => ({ batchName: "Beginners", pct: null, sessionCount: 0 }) }));
vi.mock("@/lib/actions/waitlist", () => ({ listWaitlistAction: vi.fn() }));
vi.mock("@/lib/actions/programs", () => ({ listBatchesAction: async () => [{ id: "batch", name: "Beginners", programName: "Coaching", locationName: "Club", startTime: "07:00:00", endTime: "08:00:00", coachName: "Coach Lee", capacity: 12 }] }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/components/waitlist-board", () => ({ WaitlistBoard: () => null }));
vi.mock("@/lib/services/selected-facility-access", () => ({ canSelectFacility: async () => true }));
import Page from "@/app/(owner)/owner/batches/[batchId]/page";
it("does not offer a report to a programs-only reader", async () => {
  state.allowed = false;
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ batchId: "batch" }), searchParams: Promise.resolve({ facility: "all" }) }));
  expect(html).not.toContain("Open attendance report");
  expect(html).toContain("07:00");
  expect(html).toContain("08:00");
  expect(html).toContain("Coach Lee");
  expect(html).toContain("12 places");
});
it("offers an authorized report with the explicit facility and period retained", async () => {
  state.allowed = true;
  state.reports = true;
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ batchId: "batch" }), searchParams: Promise.resolve({ facility: "all" }) }));
  expect(html).toContain("Open attendance report");
  expect(html).toContain("facility=all");
  expect(html).toContain("from=2026-11-01");
});
it("hides the report when the reports feature is disabled even with its permission", async () => {
  state.allowed = true;
  state.reports = false;
  expect(renderToStaticMarkup(await Page({ params: Promise.resolve({ batchId: "batch" }) }))).not.toContain("Open attendance report");
});
