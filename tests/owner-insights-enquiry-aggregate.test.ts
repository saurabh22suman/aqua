// @vitest-environment node
//
// The owner-insights enquiry chart must read through the SCOPED
// AGGREGATE, never the full live enquiry list.
//
// The list read (`listEnquiries`) is correct but unbounded: it returns
// every live enquiry of the tenant, with names and phones, for a chart
// that only needs six counts. This file pins the collaboration
// contract at that seam:
//
//   * the read model calls the scoped aggregate;
//   * it never calls the full list read;
//   * it passes the tenant-local window as half-open UTC instants;
//   * a requested location only NARROWS the aggregate.
//
// The database is mocked out: this file is about which collaborator
// the read model uses and with what arguments, not about the SQL
// (that is covered against a real database in
// tests/owner-insights.test.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";

const mocks = vi.hoisted(() => ({
  listEnquiries: vi.fn(),
  countEnquiriesByCurrentStage: vi.fn(),
}));

vi.mock("@/lib/services/enquiries", () => ({
  listEnquiries: mocks.listEnquiries,
  countEnquiriesByCurrentStage: mocks.countEnquiriesByCurrentStage,
}));

// The gate and the tenant timezone are not what this file is about.
vi.mock("@/lib/services/owner-insights-access", () => ({
  insightScope: vi.fn(async () => ({ timezone: "Asia/Kolkata" })),
  assertInsightAccess: vi.fn(async () => {}),
  assertInsightGrant: vi.fn(async () => {}),
}));

const { getEnquiryStageBreakdown } = await import("@/lib/services/owner-insights");

const TENANT = asTenantId("11111111-1111-4111-8111-111111111111");
const ctx = {
  tenantId: TENANT,
  userId: asUserId("22222222-2222-4222-8222-222222222222"),
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set(["reports.operational"]),
};

const PERIOD = { from: "2026-06-01", to: "2026-07-01" };
// The same window, resolved in the tenant's timezone (IST):
// 2026-06-01 00:00 IST = 2026-05-31 18:30 UTC, and 2026-07-01 00:00
// IST = 2026-06-30 18:30 UTC.
const FROM_UTC = new Date("2026-05-31T18:30:00.000Z");
const TO_UTC = new Date("2026-06-30T18:30:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  // The list read answers with an empty cohort, so the assertions
  // below fail on the CONTRACT (which collaborator was used), not on
  // a crash in the unmigrated code path.
  mocks.listEnquiries.mockResolvedValue([]);
  mocks.countEnquiriesByCurrentStage.mockResolvedValue({
    total: 3,
    byStage: [
      { stage: "new", count: 1 },
      { stage: "converted", count: 2 },
    ],
  });
});

describe("owner insights — enquiry stage aggregate", () => {
  it("reads the cohort through the scoped aggregate, never the full list", async () => {
    await getEnquiryStageBreakdown(ctx, PERIOD);

    expect(mocks.countEnquiriesByCurrentStage).toHaveBeenCalledTimes(1);
    expect(mocks.listEnquiries).not.toHaveBeenCalled();
  });

  it("passes the tenant-local window as half-open UTC instants", async () => {
    await getEnquiryStageBreakdown(ctx, PERIOD);

    expect(mocks.countEnquiriesByCurrentStage).toHaveBeenCalledWith(
      ctx,
      { fromUtc: FROM_UTC, toUtc: TO_UTC },
      { locationId: undefined },
    );
  });

  it("narrows the aggregate by the requested location", async () => {
    const locationId = "33333333-3333-4333-8333-333333333333";
    await getEnquiryStageBreakdown(ctx, { ...PERIOD, locationId });

    expect(mocks.countEnquiriesByCurrentStage).toHaveBeenCalledWith(
      ctx,
      { fromUtc: FROM_UTC, toUtc: TO_UTC },
      { locationId },
    );
  });

  it("turns the aggregate into the six stage rows, one count each", async () => {
    const result = await getEnquiryStageBreakdown(ctx, PERIOD);

    expect(result.total).toBe(3);
    expect(result.rows.map((row) => row.stage)).toEqual([
      "new",
      "contacted",
      "trial_scheduled",
      "trial_completed",
      "converted",
      "lost",
    ]);
    expect(result.rows.find((row) => row.stage === "new")?.count).toBe(1);
    expect(result.rows.find((row) => row.stage === "converted")?.count).toBe(2);
    // A stage with no enquiries in the cohort is a zero, and its share
    // is a share of the cohort — not null (the cohort is not empty).
    expect(result.rows.find((row) => row.stage === "lost")?.count).toBe(0);
    expect(result.rows.find((row) => row.stage === "lost")?.share).toBe(0);
    expect(result.rows.find((row) => row.stage === "converted")?.share).toBe(67);
  });
});
