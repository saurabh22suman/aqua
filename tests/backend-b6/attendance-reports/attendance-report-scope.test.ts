import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAttendanceReport } from "@/lib/services/owner-reports";
import {
  PERIOD,
  closeFixturePool,
  createTenantFixture,
  enableLocationScopedStaff,
  type TenantFixture,
} from "./fixture";

// Backend batch 6 — attendance-report scope.
//
// The report is a tenant read with a location boundary inside it
// (O-08). Three things have to hold at the same time:
//
//   1. another tenant's batches are never visible;
//   2. a caller restricted to their locations sees only those;
//   3. a requested facility NARROWS the caller's access — it can
//      never widen it.
//
// The eligibility rule (cancelled sessions do not count) applies to
// the scoped reads exactly as it does to the unrestricted one.

let scoped: TenantFixture;
let other: TenantFixture;
let disableLocationScoping: (() => Promise<void>) | null = null;

beforeAll(async () => {
  scoped = await createTenantFixture("scope", [
    {
      name: "Site A Batch",
      location: 0,
      sessions: [
        {
          date: "2026-11-10",
          status: "held",
          marks: [{ member: 0, status: "present" }],
        },
        {
          // Cancelled, and it still carries a mark. The scoped read
          // must not count it.
          date: "2026-11-17",
          status: "cancelled",
          marks: [{ member: 1, status: "present" }],
        },
      ],
    },
    {
      name: "Site B Batch",
      location: 1,
      sessions: [
        {
          date: "2026-11-10",
          status: "held",
          marks: [{ member: 0, status: "present" }],
        },
      ],
    },
    {
      // A tenant-wide batch: location_id IS NULL means "the whole
      // business", so it stays visible to a location-restricted
      // caller.
      name: "Tenant Wide Batch",
      location: null,
      sessions: [
        {
          date: "2026-11-10",
          status: "held",
          marks: [{ member: 0, status: "present" }],
        },
      ],
    },
  ]);

  other = await createTenantFixture("other", [
    {
      name: "Other Tenant Batch",
      sessions: [
        {
          date: "2026-11-10",
          status: "held",
          marks: [{ member: 0, status: "present" }],
        },
      ],
    },
  ]);

  disableLocationScoping = await enableLocationScopedStaff(scoped.tenantId);
});

afterAll(async () => {
  await disableLocationScoping?.();
  await scoped?.cleanup();
  await other?.cleanup();
  await closeFixturePool();
});

describe("attendance report — tenant isolation", () => {
  it("never shows another tenant's batches", async () => {
    const rows = await getAttendanceReport(scoped.ownerCtx, PERIOD);

    expect(rows.map((r) => r.batchName)).not.toContain("Other Tenant Batch");
    // The other tenant's batch is reported to its OWN tenant.
    const otherRows = await getAttendanceReport(other.ownerCtx, PERIOD);
    expect(otherRows.map((r) => r.batchName)).toEqual(["Other Tenant Batch"]);
  });
});

describe("attendance report — location scope", () => {
  it("shows a location-restricted caller only their own location and tenant-wide batches", async () => {
    const rows = await getAttendanceReport(scoped.scopedCtx, PERIOD);

    expect(rows.map((r) => r.batchName).sort()).toEqual([
      "Site A Batch",
      "Tenant Wide Batch",
    ]);
  });

  it("applies the cancelled-session rule to a scoped read too", async () => {
    const rows = await getAttendanceReport(scoped.scopedCtx, PERIOD);
    const siteA = rows.find((r) => r.batchName === "Site A Batch");

    // The held session counts; the cancelled one does not.
    expect(siteA?.sessionCount).toBe(1);
    expect(siteA?.totalMarks).toBe(1);
  });

  it("narrows an all-locations caller to the requested facility", async () => {
    const rows = await getAttendanceReport(scoped.ownerCtx, PERIOD, {
      locationId: scoped.locationIds[1],
    });

    expect(rows.map((r) => r.batchName)).toEqual(["Site B Batch"]);
  });

  it("cannot widen a location-restricted caller beyond their locations", async () => {
    const rows = await getAttendanceReport(scoped.scopedCtx, PERIOD, {
      locationId: scoped.locationIds[1],
    });

    expect(rows).toEqual([]);
  });

  // CHARACTERIZATION — the service's fail-closed default, not a
  // contract anybody should rely on.
  //
  // A context with no resolved identity cannot be location-scoped, so
  // the service falls back to "no locations at all", which the O-08
  // predicate turns into tenant-wide batches only.
  //
  // This used to be the ATTENTION report action's effective
  // behaviour: the action passed a narrowed `{ tenantId }` context
  // and the caller saw this set instead of their own location. The
  // action now forwards the complete authorised context (see
  // lib/actions/owner-reports.ts), so no request path reaches this
  // branch any more. The test stays because the default is real: a
  // future adapter that narrows the context again would silently
  // produce this set, and this is the fingerprint of that failure.
  it("shows only tenant-wide batches to a caller with no resolved identity", async () => {
    const rows = await getAttendanceReport(scoped.tenantOnlyCtx, PERIOD);

    expect(rows.map((r) => r.batchName)).toEqual(["Tenant Wide Batch"]);
  });
});
