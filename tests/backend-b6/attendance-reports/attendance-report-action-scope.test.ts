import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PERIOD,
  closeFixturePool,
  createTenantFixture,
  enableLocationScopedStaff,
  type TenantFixture,
} from "./fixture";

// Backend batch 6 (second slice) — the attendance-report ACTION
// boundary.
//
// The failure class: an action that rebuilds a narrowed context
// (`{ tenantId }`) throws away the caller's location scope before the
// service can apply it. The service's O-08 gate cannot see what the
// adapter discarded, so a location-restricted caller is silently
// served the WRONG scope — not an error, not a leak, just a report
// that does not answer the question the screen asked.
//
// This file is an ACTION/SERVICE INTEGRATION test: the real actions,
// the real service, the real query and a real database. Only the
// session resolution (`requireDefaultCtx`) is mocked, because a
// browser session is not what is under test — the propagation of the
// context it returns IS. `requirePermission` stays REAL: the
// permission gate must still run, and a caller without the grant must
// still be refused.
//
// The fixtures: one tenant, three locations, batches at each of them
// plus a tenant-wide batch, a zero-session batch and a batch whose
// only session was cancelled. A second tenant carries its own batch,
// so a leak would be visible.
//
// `access.location_scoped_staff` is switched ON for the tenant: with
// the switch off the location predicate is a no-op and every caller
// sees every location, which would hide the defect completely.

const mocks = vi.hoisted(() => ({ ctx: vi.fn() }));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: mocks.ctx,
  NotFoundError: class NotFoundError extends Error {},
}));

const { getAttendanceReportAction, attendanceReportCsvAction } = await import(
  "@/lib/actions/owner-reports"
);

let scoped: TenantFixture;
let other: TenantFixture;
let disableLocationScoping: (() => Promise<void>) | null = null;

/** The complete authorised context, exactly as requireDefaultCtx()
 *  resolves it: the user, the role, the permission set, the feature
 *  set AND the caller's location scope. */
function callerCtx(
  fixture: TenantFixture,
  opts: { allLocations: boolean; locationIds: string[] },
) {
  return {
    userId: fixture.ownerCtx.userId!,
    tenantId: fixture.tenantId,
    membershipId: "b6-membership",
    roleKey: "owner",
    roleId: "b6-role",
    slug: "",
    allLocations: opts.allLocations,
    locationIds: opts.locationIds,
    permissions: new Set(["reports.operational"]),
    features: new Set(["reports"]),
  };
}

function restrictedCaller(fixture: TenantFixture) {
  return callerCtx(fixture, {
    allLocations: false,
    locationIds: [fixture.locationIds[0]],
  });
}

function unrestrictedCaller(fixture: TenantFixture) {
  return callerCtx(fixture, {
    allLocations: true,
    locationIds: [...fixture.locationIds],
  });
}

/** The CSV data lines (everything after the header). */
function csvDataLines(body: string): string[] {
  return body.trim().split("\n").slice(1).filter((line) => line.length > 0);
}

beforeAll(async () => {
  scoped = await createTenantFixture("action", [
    {
      name: "Site A Batch",
      location: 0,
      sessions: [
        {
          date: "2026-11-10",
          status: "held",
          marks: [{ member: 0, status: "present" }],
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
      name: "Site C Batch",
      location: 2,
      sessions: [
        {
          date: "2026-11-10",
          status: "held",
          marks: [{ member: 0, status: "present" }],
        },
      ],
    },
    {
      // No sessions at all: reported with sessionCount 0 and pct null.
      name: "Zero Session Batch",
      location: 0,
      sessions: [],
    },
    {
      // Cancelled, and it still carries a mark.
      name: "Cancelled Batch",
      location: 0,
      sessions: [
        {
          date: "2026-11-10",
          status: "cancelled",
          marks: [{ member: 0, status: "present" }],
        },
      ],
    },
    {
      // Tenant-wide: location_id IS NULL means "the whole business",
      // so it stays visible to a location-restricted caller.
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

  other = await createTenantFixture("action-other", [
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.mockResolvedValue(restrictedCaller(scoped));
});

describe("attendance report action — the caller's location scope survives the hop", () => {
  it("serves a location-restricted caller only their own location and tenant-wide batches", async () => {
    const rows = await getAttendanceReportAction(PERIOD);

    expect(rows.map((r) => r.batchName).sort()).toEqual([
      "Cancelled Batch",
      "Site A Batch",
      "Tenant Wide Batch",
      "Zero Session Batch",
    ]);
    // The other locations are not the caller's to see.
    expect(rows.map((r) => r.batchName)).not.toContain("Site B Batch");
    expect(rows.map((r) => r.batchName)).not.toContain("Site C Batch");
  });

  it("narrows a location-restricted caller to the facility they asked for", async () => {
    const rows = await getAttendanceReportAction({
      ...PERIOD,
      locationId: scoped.locationIds[0],
    });

    // The tenant-wide batch has no facility, so an explicit facility
    // request excludes it — the request narrows, it never widens.
    expect(rows.map((r) => r.batchName).sort()).toEqual([
      "Cancelled Batch",
      "Site A Batch",
      "Zero Session Batch",
    ]);
  });

  it("cannot widen a location-restricted caller to a facility they do not hold", async () => {
    const rows = await getAttendanceReportAction({
      ...PERIOD,
      locationId: scoped.locationIds[1],
    });

    // Empty, not an error and not a wider report.
    expect(rows).toEqual([]);
  });

  it("serves an all-locations caller every facility", async () => {
    mocks.ctx.mockResolvedValue(unrestrictedCaller(scoped));

    const rows = await getAttendanceReportAction(PERIOD);

    expect(rows.map((r) => r.batchName).sort()).toEqual([
      "Cancelled Batch",
      "Site A Batch",
      "Site B Batch",
      "Site C Batch",
      "Tenant Wide Batch",
      "Zero Session Batch",
    ]);
  });

  it("narrows an all-locations caller to the facility they asked for", async () => {
    mocks.ctx.mockResolvedValue(unrestrictedCaller(scoped));

    const rows = await getAttendanceReportAction({
      ...PERIOD,
      locationId: scoped.locationIds[1],
    });

    expect(rows.map((r) => r.batchName)).toEqual(["Site B Batch"]);
  });
});

describe("attendance report action — the numbers it reports", () => {
  it("reports a zero-session batch with no percentage rather than 0%", async () => {
    const rows = await getAttendanceReportAction(PERIOD);
    const zero = rows.find((r) => r.batchName === "Zero Session Batch");

    expect(zero).toBeDefined();
    expect(zero?.sessionCount).toBe(0);
    expect(zero?.totalMarks).toBe(0);
    // "No sessions yet" is not "nobody came": never 0.
    expect(zero?.pct).toBeNull();
  });

  it("excludes a cancelled session that carries marks", async () => {
    const rows = await getAttendanceReportAction(PERIOD);
    const cancelled = rows.find((r) => r.batchName === "Cancelled Batch");

    expect(cancelled).toBeDefined();
    expect(cancelled?.sessionCount).toBe(0);
    expect(cancelled?.totalMarks).toBe(0);
    expect(cancelled?.pct).toBeNull();
  });
});

describe("attendance report CSV action — same scope as the screen", () => {
  it("exports exactly the rows the screen shows", async () => {
    const rows = await getAttendanceReportAction(PERIOD);
    const csv = await attendanceReportCsvAction(PERIOD);

    expect(csvDataLines(csv.body)).toHaveLength(rows.length);
    for (const row of rows) {
      expect(csv.body).toContain(row.batchName);
    }
    // The other locations are not exported either.
    expect(csv.body).not.toContain("Site B Batch");
    expect(csv.body).not.toContain("Site C Batch");
  });

  it("exports exactly the rows the screen shows for an explicit facility", async () => {
    const rows = await getAttendanceReportAction({
      ...PERIOD,
      locationId: scoped.locationIds[0],
    });
    const csv = await attendanceReportCsvAction({
      ...PERIOD,
      locationId: scoped.locationIds[0],
    });

    expect(csvDataLines(csv.body)).toHaveLength(rows.length);
    expect(csv.body).toContain("Site A Batch");
    expect(csv.body).not.toContain("Site B Batch");
  });

  it("exports an empty report, not a zeroed one, when the scope has no rows", async () => {
    const rows = await getAttendanceReportAction({
      ...PERIOD,
      locationId: scoped.locationIds[1],
    });
    const csv = await attendanceReportCsvAction({
      ...PERIOD,
      locationId: scoped.locationIds[1],
    });

    expect(rows).toEqual([]);
    // The header and nothing else — no invented 0% rows.
    expect(csvDataLines(csv.body)).toEqual([]);
    expect(csv.body).not.toContain("Site B Batch");
  });

  it("never exports another tenant's batch", async () => {
    mocks.ctx.mockResolvedValue(unrestrictedCaller(scoped));

    const csv = await attendanceReportCsvAction(PERIOD);

    expect(csv.body).not.toContain("Other Tenant Batch");
  });
});

describe("attendance report action — the permission gate still runs", () => {
  it("refuses a caller without the operational-reports grant and returns no data", async () => {
    mocks.ctx.mockResolvedValue({
      ...restrictedCaller(scoped),
      permissions: new Set<string>(),
    });

    await expect(getAttendanceReportAction(PERIOD)).rejects.toThrow(
      /forbidden.*reports\.operational/i,
    );
    await expect(attendanceReportCsvAction(PERIOD)).rejects.toThrow(
      /forbidden.*reports\.operational/i,
    );
  });

  it("refuses a tenant whose reports feature is not enabled", async () => {
    mocks.ctx.mockResolvedValue({
      ...restrictedCaller(scoped),
      features: new Set<string>(),
    });

    await expect(getAttendanceReportAction(PERIOD)).rejects.toThrow(
      /forbidden.*reports\.operational/i,
    );
  });
});
