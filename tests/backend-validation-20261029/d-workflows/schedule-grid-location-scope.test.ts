import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
// The privileged pool is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only — seeding the tenant/locations/batches/sessions the tables
// under FORCE RLS hide from the application pool. Every assertion below
// runs against the application's own service, which connects as
// `app_login` under tenant RLS.
import { asTenantId, asUserId } from "@/lib/ids";

// DEF-01 — the owner schedule grid read must never widen the caller's
// location scope.
//
// `getScheduleGrid` builds its WHERE clause as:
//
//   if (locationId) conditions.push(eq(sessions.locationId, locationId));
//   else          conditions.push(locationPredicate(sessions.locationId, access));
//
// so a caller that NAMES a location never gets the access predicate
// applied. The location id reaches the service straight from the
// ?location= query string of app/(owner)/owner/schedule/page.tsx, and the
// location list offered in that UI is unscoped
// (lib/services/people.ts listLocations returns every tenant location).
//
// The rule the sibling reads already follow (lib/services/roster.ts:76-78,
// lib/services/attendance-report-query.ts:109-111): the caller's access is
// applied FIRST and a requested locationId may only NARROW it, never
// widen it.
//
// The scope key `access.location_scoped_staff` defaults OFF, so this
// hole only opens where the tenant switched location scoping on — which
// is exactly the configuration the O-08 boundary is for.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";
const DATE = "2026-10-29";

const tenant = asTenantId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const programId = uuidv7();
const batchA = uuidv7();
const batchB = uuidv7();
const sessionA = uuidv7();
const sessionB = uuidv7();
const actor = asUserId(uuidv7());

const restrictedCtx = {
  tenantId: tenant,
  userId: actor,
  requestId: uuidv7(),
  allLocations: false,
  locationIds: [locA],
  roleKey: "receptionist",
};

const ownerCtx = {
  tenantId: tenant,
  userId: actor,
  requestId: uuidv7(),
  allLocations: true,
  locationIds: [] as string[],
  roleKey: "owner",
};

let scheduleGrid: typeof import("@/lib/services/schedule-grid");

beforeAll(async () => {
  scheduleGrid = await import("@/lib/services/schedule-grid");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Grid Scope', 'active', $3)",
    [tenant, `d-grid-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true), ($3, $2, 'Site B', false)",
    [locA, tenant, locB],
  );
  await admin.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Grid Program')",
    [programId, tenant],
  );
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id)
     values ($1, $3, $4, 'Batch A', 10, '{1}', '07:00', '08:00', $5),
            ($2, $3, $4, 'Batch B', 10, '{2}', '09:00', '10:00', $6)`,
    [batchA, batchB, tenant, programId, locA, locB],
  );
  await admin.query(
    `insert into sessions (id, tenant_id, batch_id, session_date, starts_at, ends_at, status, location_id)
     values ($1, $3, $4, $7, '2026-10-29T07:00:00Z', '2026-10-29T08:00:00Z', 'scheduled', $5),
            ($2, $3, $6, $7, '2026-10-29T09:00:00Z', '2026-10-29T10:00:00Z', 'scheduled', $8)`,
    [sessionA, sessionB, tenant, batchA, locA, batchB, DATE, locB],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9197${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into config_values (key, scope_type, scope_id, tenant_id, value)
     values ('access.location_scoped_staff', 'tenant', $1, $2, 'true'::jsonb)
     on conflict do nothing`,
    [tenant, tenant],
  );
}, 60_000);

afterAll(async () => {
  await admin.query("delete from sessions where tenant_id = $1", [tenant]);
  await admin.query("delete from config_values where tenant_id = $1", [tenant]);
  await admin.query("delete from batches where tenant_id = $1", [tenant]);
  await admin.query("delete from programs where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("DEF-01 schedule grid location scope", () => {
  it("does not return another location's sessions when the caller names that location", async () => {
    const rows = await scheduleGrid.getScheduleGrid(restrictedCtx, {
      fromDate: DATE,
      toDate: DATE,
      locationId: locB,
    });
    expect(rows).toEqual([]);
  });

  it("returns only the caller's own location without a location filter", async () => {
    const rows = await scheduleGrid.getScheduleGrid(restrictedCtx, {
      fromDate: DATE,
      toDate: DATE,
    });
    expect(rows.map((r) => r.id)).toEqual([sessionA]);
  });

  it("still returns the caller's own location's sessions", async () => {
    const rows = await scheduleGrid.getScheduleGrid(restrictedCtx, {
      fromDate: DATE,
      toDate: DATE,
      locationId: locA,
    });
    expect(rows.map((r) => r.id)).toEqual([sessionA]);
  });

  it("lets an unrestricted owner read every location", async () => {
    const all = await scheduleGrid.getScheduleGrid(ownerCtx, {
      fromDate: DATE,
      toDate: DATE,
    });
    expect(all.map((r) => r.id).sort()).toEqual([sessionA, sessionB].sort());

    const onlyB = await scheduleGrid.getScheduleGrid(ownerCtx, {
      fromDate: DATE,
      toDate: DATE,
      locationId: locB,
    });
    expect(onlyB.map((r) => r.id)).toEqual([sessionB]);
  });
});
