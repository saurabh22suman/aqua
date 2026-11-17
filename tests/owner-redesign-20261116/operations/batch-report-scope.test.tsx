// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/context", () => ({ NotFoundError: class NotFoundError extends Error {}, requireDefaultCtx: async () => ({ tenantId: "tenant", permissions: new Set(["programs.read"]) }) }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: (_ctx: unknown, permission: string) => permission === "reports.operational", hasFeature: () => true }));
vi.mock("@/db/tenant", () => ({ withTenant: async () => [{ timezone: "Asia/Kolkata" }] }));
vi.mock("@/lib/services/attendance-history", () => ({ currentMonthPeriod: () => ({ from: "2026-11-01", to: "2026-12-01" }), getBatchAttendanceSummary: async () => ({ batchName: "Beginners", pct: null, sessionCount: 0 }) }));
vi.mock("@/lib/actions/waitlist", () => ({ listWaitlistAction: vi.fn() }));
vi.mock("@/lib/actions/programs", () => ({ listBatchesAction: async () => [{ id: "batch", name: "Beginners", programName: "Coaching", locationName: "Club", startTime: "07:00:00", endTime: "08:00:00", coachName: "Coach Lee", capacity: 12 }] }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/components/waitlist-board", () => ({ WaitlistBoard: () => null }));
vi.mock("@/lib/services/selected-facility-access", () => ({ canSelectFacility: async () => true }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
import BatchDetailPage from "@/app/(owner)/owner/batches/[batchId]/page";

it.each([
  [{ facility: "all" }, "all"],
  [{ facility: "11111111-1111-4111-8111-111111111111" }, "11111111-1111-4111-8111-111111111111"],
  [{ location: "11111111-1111-4111-8111-111111111111" }, "11111111-1111-4111-8111-111111111111"],
])("preserves explicit report scope %j", async (query, facility) => {
  const page = await BatchDetailPage({ params: Promise.resolve({ batchId: "batch" }), searchParams: Promise.resolve(query) });
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(page), "text/html");
  const link = Array.from(doc.querySelectorAll("a")).find((a) => a.textContent === "Open attendance report");
  const url = new URL(link?.getAttribute("href") ?? "", "http://localhost");
  expect(url.pathname).toBe("/owner/reports");
  expect(url.searchParams.get("from")).toBe("2026-11-01");
  expect(url.searchParams.get("to")).toBe("2026-12-01");
  expect(url.searchParams.get("facility")).toBe(facility);
});
