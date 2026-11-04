import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { batches, locations, programs, sessions } from "@/db/schema";
import { getOwnerDashboard } from "@/lib/services/dashboard";
import { addDays, todayInZone } from "@/lib/time/tz";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// Owner light · Operations lane (3 November 2026) — Home session display data
// AND the physical-session venue rule the Home reads share with the Calendar.
//
// Two things are pinned against a real database (the tier1 disposable-fixture
// convention: tenants through the privileged pool, everything else through
// withTenant):
//
//   1. the additive display fields on today's lanes;
//   2. BOTH Home session reads scope by the session's OWN venue —
//      `sessions.locationId`, the column the Calendar's session read and the
//      coach schedule already scope by — not the batch's CURRENT default.
//      The generator snapshots the venue from the batch, so a session keeps
//      its venue when the batch default changes; scoping by the batch would
//      show a caller a session where it is not.
//
// Intended RED before the patch (values, not import/setup failures):
//   * `startsAt` / `endsAt` / `locationName` / `status` are undefined;
//   * the MISMATCH session (batch default Hall A, session venue Hall B) is
//     visible to a caller restricted to Hall A and names Hall B;
//   * the earliest FUTURE mismatch becomes the "next class" for a caller
//     restricted to (or filtering) Hall A instead of the authorised Hall A
//     session.
//
// The wall clock is pinned to NOON on the tenant-local `today` (computed
// above with the real clock, before the pin) so "today" and "now" mean the
// same thing whenever the suite runs: today's 00:00–04:00 IST fixtures are
// past, tomorrow's 09:00/10:00 IST fixtures are future, and the next-class
// assertion never depends on the wall clock. Only Date is faked — the pg
// driver's timers stay real — and it is restored in afterAll.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";
const today = todayInZone(TZ);
const tomorrow = addDays(today, 1);

const tenantId: TenantId = asTenantId(uuidv7());
const otherTenantId: TenantId = asTenantId(uuidv7());

let hallA = "";
let hallB = "";
let programId = "";
let batchPlain = "";
let batchHeld = "";
let batchMismatch = "";
let batchNoVenue = "";
let batchNextMismatch = "";
let batchNextA = "";
let otherBatch = "";

/** The additive display contract this test pins (typed before it lands). */
type LaneDisplay = {
  startsAt?: string;
  endsAt?: string;
  locationName?: string | null;
  status?: string;
};

/** The IST instant for a wall clock on a date (UTC+05:30, no DST). */
function istInstant(dateIso: string, hour: number, minute = 0): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(
    Date.UTC(year!, month! - 1, day!, hour - 5, minute - 30, 0),
  );
}

async function addBatch(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  id: TenantId,
  name: string,
  batchVenueId: string | null,
  sessionVenueId: string | null,
  date: string,
  hour: number,
  status = "scheduled",
): Promise<string> {
  const [batch] = await tx
    .insert(batches)
    .values({
      tenantId: id,
      programId,
      name,
      capacity: 12,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: `${String(hour).padStart(2, "0")}:00`,
      endTime: `${String(hour + 1).padStart(2, "0")}:00`,
      locationId: batchVenueId,
    })
    .returning({ id: batches.id });
  await tx.insert(sessions).values({
    tenantId: id,
    batchId: batch.id,
    sessionDate: date,
    locationId: sessionVenueId,
    startsAt: istInstant(date, hour),
    endsAt: istInstant(date, hour + 1),
    status,
  });
  return batch.id;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Noon in the TENANT's own zone (Asia/Kolkata, +05:30 — the same constant
  // the fixtures are built with), so the tenant calendar day is unambiguous
  // whatever the runner's own timezone is.
  vi.setSystemTime(new Date(`${today}T12:00:00+05:30`));

  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  for (const [id, slug, name] of [
    [tenantId, `home-display-${RUN}`, "Home Display"],
    [otherTenantId, `home-display-other-${RUN}`, "Home Display Other"],
  ] as const) {
    await admin.query(
      "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, $3, $4, $5)",
      [id, slug, name, plan.rows[0]?.id ?? null, TZ],
    );
  }

  await withTenant(tenantId, async (tx) => {
    const [a] = await tx
      .insert(locations)
      .values({ tenantId, name: "Hall A", isPrimary: true })
      .returning({ id: locations.id });
    hallA = a.id;
    const [b] = await tx
      .insert(locations)
      .values({ tenantId, name: "Hall B" })
      .returning({ id: locations.id });
    hallB = b.id;
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, name: "Display Program" })
      .returning({ id: programs.id });
    programId = p.id;

    // TODAY (past from 04:00 IST): batch default A / session venue A.
    batchPlain = await addBatch(tx, tenantId, `Plain ${RUN}`, hallA, hallA, today, 0);
    // Batch default B / session venue B, HELD.
    batchHeld = await addBatch(tx, tenantId, `Held ${RUN}`, hallB, hallB, today, 1, "held");
    // THE MISMATCH: the batch's CURRENT default is Hall A, but the session
    // kept venue Hall B.
    batchMismatch = await addBatch(tx, tenantId, `Mismatch ${RUN}`, hallA, hallB, today, 2);
    // No venue at all: the shared rule treats null as visible.
    batchNoVenue = await addBatch(tx, tenantId, `NoVenue ${RUN}`, hallA, null, today, 3);

    // TOMORROW (always future): the earliest future MISMATCH (batch default
    // Hall A, session venue Hall B)…
    batchNextMismatch = await addBatch(tx, tenantId, `NextMismatch ${RUN}`, hallA, hallB, tomorrow, 9);
    // …and the authorised Hall A session an hour later.
    batchNextA = await addBatch(tx, tenantId, `NextA ${RUN}`, hallA, hallA, tomorrow, 10);
  });

  await withTenant(otherTenantId, async (tx) => {
    const [p] = await tx
      .insert(programs)
      .values({ tenantId: otherTenantId, name: "Other Program" })
      .returning({ id: programs.id });
    const [b] = await tx
      .insert(batches)
      .values({
        tenantId: otherTenantId,
        programId: p.id,
        name: `Other ${RUN}`,
        capacity: 6,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "11:00",
        endTime: "12:00",
      })
      .returning({ id: batches.id });
    otherBatch = b.id;
    await tx.insert(sessions).values({
      tenantId: otherTenantId,
      batchId: b.id,
      sessionDate: today,
      startsAt: istInstant(today, 11),
      endsAt: istInstant(today, 12),
    });
  });

  // The scoped-staff switch the dashboard already honours, on for the whole
  // file so the restricted caller's access is a real boundary in every case.
  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [uuidv7(), tenantId],
  );
});

afterAll(async () => {
  vi.useRealTimers();
  for (const id of [tenantId, otherTenantId]) {
    await admin.query("delete from config_values where tenant_id = $1", [id]);
    for (const table of [
      "attendance",
      "sessions",
      "enrolments",
      "batches",
      "programs",
      "members",
      "consents",
      "guardianships",
      "persons",
      "locations",
    ]) {
      await admin.query(`delete from ${table} where tenant_id = $1`, [id]);
    }
    await admin.query("delete from tenants where id = $1", [id]);
  }
  await admin.end();
});

type OwnerCtx = ActionCtx & { permissions: Set<string> };

/**
 * The disposable authenticated actor.
 *
 * The synthetic id is the repository's existing convention for a
 * disposable-fixture caller (`asUserId(uuidv7())`, as in
 * tests/review-dashboard-scope.test.ts). It is load-bearing here: with the
 * scoped-staff switch ON, resolveLocationAccess denies a context that has
 * no userId BEFORE it reads allLocations — an anonymous context sees
 * nothing and would fail on the fixture, not on the contract.
 */
const actorId = asUserId(uuidv7());
const PERMISSIONS = new Set([
  "dashboard.view",
  "reports.financial",
  "invoices.read",
]);

/** An owner who may see every permitted location. */
const ownerAll: OwnerCtx = {
  tenantId,
  userId: actorId,
  roleKey: "owner",
  allLocations: true,
  permissions: PERMISSIONS,
};

/**
 * A caller restricted to Hall A. Built at CALL time, after beforeAll has
 * created the location: a module-evaluation list would capture the empty
 * `hallA` and deny everything.
 */
function restrictedA(): OwnerCtx {
  return {
    tenantId,
    userId: actorId,
    roleKey: "admin",
    allLocations: false,
    locationIds: [hallA],
    permissions: PERMISSIONS,
  };
}

type Lane = { batchId: string } & LaneDisplay;

function laneFor(lanes: Array<{ batchId: string }>, batchId: string) {
  return lanes.find((lane) => lane.batchId === batchId) as Lane | undefined;
}

describe("today's lanes carry the Home session display data", () => {
  it("carries the session's own times, venue and status", async () => {
    const data = await getOwnerDashboard(ownerAll);
    const lane = laneFor(data.todaysLanes, batchPlain);

    expect(lane).toBeTruthy();
    // The values, not the shape: before the patch these are undefined and
    // these assertions are the intended RED.
    expect(lane!.startsAt).toBe(istInstant(today, 0).toISOString());
    expect(lane!.endsAt).toBe(istInstant(today, 1).toISOString());
    expect(lane!.locationName).toBe("Hall A");
    expect(lane!.status).toBe("scheduled");
  });

  it("reports a real held status instead of inferring one", async () => {
    const data = await getOwnerDashboard(ownerAll);
    const lane = laneFor(data.todaysLanes, batchHeld);

    expect(lane!.status).toBe("held");
    expect(lane!.locationName).toBe("Hall B");
  });

  it("shows an unrestricted caller the session's ACTUAL venue, not the batch default", async () => {
    const data = await getOwnerDashboard(ownerAll);
    const lane = laneFor(data.todaysLanes, batchMismatch);

    expect(lane).toBeTruthy();
    // The batch defaults to Hall A; the session happens at Hall B.
    expect(lane!.locationName).toBe("Hall B");
    expect(lane!.startsAt).toBe(istInstant(today, 2).toISOString());
  });

  it("treats a session with no venue as visible with a null venue", async () => {
    const data = await getOwnerDashboard(ownerAll);
    const lane = laneFor(data.todaysLanes, batchNoVenue);

    expect(lane).toBeTruthy();
    expect(lane!.locationName).toBeNull();
  });

  it("never leaks another tenant's session or its venue name", async () => {
    const data = await getOwnerDashboard(ownerAll);

    expect(data.todaysLanes.some((lane) => lane.batchId === otherBatch)).toBe(false);
  });

  it("narrows to a single facility by the session's own venue", async () => {
    const data = await getOwnerDashboard(ownerAll, { locationId: hallA });

    expect(laneFor(data.todaysLanes, batchPlain)).toBeTruthy();
    expect(laneFor(data.todaysLanes, batchHeld)).toBeUndefined();
    expect(laneFor(data.todaysLanes, batchMismatch)).toBeUndefined();
    // An explicit facility request excludes the unassigned venue — the
    // shared predicate is an equality, not an OR-NULL.
    expect(laneFor(data.todaysLanes, batchNoVenue)).toBeUndefined();
    // The confirmed scope gap: nothing in the list may name Hall B.
    expect(
      data.todaysLanes.some(
        (lane) => (lane as LaneDisplay).locationName === "Hall B",
      ),
    ).toBe(false);
  });

  it("keeps a restricted caller's lanes to the venues they can see", async () => {
    const data = await getOwnerDashboard(restrictedA());

    // Hall A's own session and the unassigned-venue session are visible
    // (the shared rule allows null); Hall B's session and the MISMATCH
    // session (batch default Hall A, venue Hall B) are NOT.
    expect(laneFor(data.todaysLanes, batchPlain)).toBeTruthy();
    expect(laneFor(data.todaysLanes, batchNoVenue)).toBeTruthy();
    expect(laneFor(data.todaysLanes, batchHeld)).toBeUndefined();
    expect(laneFor(data.todaysLanes, batchMismatch)).toBeUndefined();
    expect(
      data.todaysLanes.some(
        (lane) => (lane as LaneDisplay).locationName === "Hall B",
      ),
    ).toBe(false);
  });
});

describe("the next class uses the same physical-session venue rule", () => {
  it("does not choose a future mismatch for a caller restricted to Hall A", async () => {
    const data = await getOwnerDashboard(restrictedA());

    expect(data.nextClass).toBeTruthy();
    // The earliest future session is the batch-A/Hall-B mismatch; it must
    // not be chosen. NextClass carries no session id, so the batch, the
    // start instant and the (absent) coach are the safe assertions.
    expect(data.nextClass!.batchId).toBe(batchNextA);
    expect(data.nextClass!.startsAt.toISOString()).toBe(
      istInstant(tomorrow, 10).toISOString(),
    );
    expect(data.nextClass!.coachName).toBeNull();
  });

  it("does not choose it for a selected Hall A either", async () => {
    const data = await getOwnerDashboard(restrictedA(), { locationId: hallA });

    expect(data.nextClass).toBeTruthy();
    expect(data.nextClass!.batchId).toBe(batchNextA);
    expect(data.nextClass!.startsAt.toISOString()).toBe(
      istInstant(tomorrow, 10).toISOString(),
    );
  });

  it("still shows a caller who may see every venue the real earliest session", async () => {
    const data = await getOwnerDashboard(ownerAll);

    expect(data.nextClass).toBeTruthy();
    // The control: the earliest future session IS the mismatch, and the
    // unrestricted caller sees it at its real venue's batch.
    expect(data.nextClass!.batchId).toBe(batchNextMismatch);
    expect(data.nextClass!.startsAt.toISOString()).toBe(
      istInstant(tomorrow, 9).toISOString(),
    );
    expect(data.nextClass!.coachName).toBeNull();
  });
});
