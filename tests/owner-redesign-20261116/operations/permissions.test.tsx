// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ waitlist: vi.fn(async () => { throw new Error("enquiries.read required"); }) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ permissions: new Set(["programs.read"]) }), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/context", () => ({ NotFoundError: class NotFoundError extends Error {}, requireDefaultCtx: async () => ({ tenantId: "tenant", permissions: new Set(["programs.read"]) }) }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: (ctx: { permissions: Set<string> }, permission: string) => ctx.permissions.has(permission), hasFeature: () => true }));
vi.mock("@/db/tenant", () => ({ withTenant: async () => [{ timezone: "Asia/Kolkata" }] }));
vi.mock("@/lib/services/attendance-history", () => ({ currentMonthPeriod: () => ({ from: "2026-11-01", to: "2026-11-30" }), getBatchAttendanceSummary: async () => ({ batchName: "Beginners", pct: null, sessionCount: 0 }) }));
vi.mock("@/lib/actions/waitlist", () => ({ listWaitlistAction: mocks.waitlist }));
vi.mock("@/lib/actions/programs", () => ({ listBatchesAction: async () => [{ id: "batch", name: "Beginners", programName: "Coaching", locationName: "Club" }] }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({locale:"en",overrides:{}}) }));
vi.mock("@/lib/terminology/keys", async (original) => ({ ...await original<typeof import("@/lib/terminology/keys")>(), resolveTerm: () => "members" }));
vi.mock("@/components/waitlist-board", () => ({ WaitlistBoard: () => <div>Waitlist</div> }));
vi.mock("@/lib/services/selected-facility-access", () => ({ canSelectFacility: async (_ctx: unknown, id: string) => id === "11111111-1111-4111-8111-111111111111" }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

import BatchDetailPage from "@/app/(owner)/owner/batches/[batchId]/page";

describe("batch detail permissions", () => {
  it("renders for programs.read without querying or showing the enquiry waitlist", async () => {
    const page = await BatchDetailPage({ params: Promise.resolve({ batchId: "batch" }) });
    expect(renderToStaticMarkup(page)).toContain("Beginners");
    expect(renderToStaticMarkup(page)).not.toContain("Waitlist");
    expect(mocks.waitlist).not.toHaveBeenCalled();
  });
  it("retains an explicit selection in the return link", async () => {
    const page = await BatchDetailPage({ params: Promise.resolve({ batchId: "batch" }), searchParams: Promise.resolve({ facility: "11111111-1111-4111-8111-111111111111" }) });
    expect(renderToStaticMarkup(page)).toContain("/owner/programs?facility=11111111-1111-4111-8111-111111111111");
  });
  it("rejects a malformed or inaccessible selection", async () => {
    const page = await BatchDetailPage({ params: Promise.resolve({ batchId: "batch" }), searchParams: Promise.resolve({ facility: "not-valid" }) });
    expect(renderToStaticMarkup(page)).toContain("Facility unavailable");
  });
});
