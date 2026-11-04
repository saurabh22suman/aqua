import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
// The privileged pool is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only. Every assertion below runs against the application's own
// service, which connects as `app_login` under tenant RLS.
import { asTenantId, asUserId } from "@/lib/ids";
import { withTenant } from "@/db/tenant";
import { persons } from "@/db/schema/people";
import { staff } from "@/db/schema/staff";

// Cross-lane scope gap (raised by lane C) — the coach load report
// ignored the caller's location scope.
//
// `getCoachLoad` aggregates every session of the tenant in the period
// and groups it by the recorded coach (sessions.coach_id). The sibling
// reports apply the O-08 location policy first: the caller's access is
// applied and a requested location may only NARROW it
// (lib/services/attendance-report-query.ts:73-112,
// lib/services/roster.ts:70-78). The reports isolation boundary is
// "a receptionist attached to one location sees only their own
// location's numbers" — the coach load report was the one report that
// did not honour it.
//
// This closes that boundary. It changes no entitlement: the recorded
// coach identity and name stay exactly as they are.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const otherTenant = asTenantId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const programId = uuidv7();
const batchA = uuidv7();
const batchB = uuidv7();
let coachAStaffId = "";
let coachBStaffId = "";
const actor = asUserId(uuidv7());

const PERIOD = { from: "2026-10-01", to: "2026-11-01" };

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

let coachLoad: typeof import("@/lib/services/coach-load");

async function enableLocationScope(): Promise<void> {
  await admin.query(
    `insert into config_values (key, scope_type, scope_id, tenant_id, value)
     values ('access.location_scoped_staff', 'tenant', $1, $2, 'true'::jsonb)
     on conflict do nothing`,
    [tenant, tenant],
  );
}

async function disableLocationScope(): Promise<void> {
  await admin.query("delete from config_values where tenant_id = $1", [tenant]);
}

beforeAll(async () => {
  coachLoad = await import("@/lib/services/coach-load");

  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9189${String(Date.now()).slice(-8)}`,
  ]);
  for (const [id, slug] of [
    [tenant, `d-load-${RUN}`],
    [otherTenant, `d-load-other-${RUN}`],
  ] as const) {
    await admin.query(
      "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Coach Load', 'active', $3)",
      [id, slug, TZ],
    );
  }
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true), ($3, $2, 'Site B', false)",
    [locA, tenant, locB],
  );
  await admin.query("insert into programs (id, tenant_id, name) values ($1, $2, 'Load Program')", [
    programId,
    tenant,
  ]);
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id)
     values ($1, $3, $4, 'Site A Batch', 10, '{1}', '07:00', '08:00', $5),
            ($2, $3, $4, 'Site B Batch', 10, '{2}', '09:00', '10:00', $6)`,
    [batchA, batchB, tenant, programId, locA, locB],
  );
  // Coach A coaches at Site A, coach B at Site B.
  for (const [fullName, type] of [
    ["Coach A", "coach"],
    ["Coach B", "coach"],
  ] as const) {
    const staffId = await withTenant(tenant, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ tenantId: tenant, fullName, dateOfBirth: "1990-01-01" })
        .returning({ id: persons.id });
      const [row] = await tx
        .insert(staff)
        .values({ tenantId: tenant, personId: person!.id, staffType: type })
        .returning({ id: staff.id });
      return row!.id;
    });
    if (fullName === "Coach A") coachAStaffId = staffId;
    else coachBStaffId = staffId;
  }
  await withTenant(tenant, async (tx) => {
    await tx.insert((await import("@/db/schema/scheduling")).sessions).values([
      {
        id: uuidv7(),
        tenantId: tenant,
        batchId: batchA,
        sessionDate: "2026-10-06",
        startsAt: new Date("2026-10-06T07:00:00Z"),
        endsAt: new Date("2026-10-06T08:00:00Z"),
        status: "held",
        coachId: coachAStaffId as never,
        locationId: locA as never,
      },
      {
        id: uuidv7(),
        tenantId: tenant,
        batchId: batchB,
        sessionDate: "2026-10-07",
        startsAt: new Date("2026-10-07T09:00:00Z"),
        endsAt: new Date("2026-10-07T10:00:00Z"),
        status: "held",
        coachId: coachBStaffId as never,
        locationId: locB as never,
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await admin.query("delete from sessions where tenant_id in ($1, $2)", [tenant, otherTenant]);
  await admin.query("delete from staff where tenant_id = $1", [tenant]);
  await admin.query("delete from persons where tenant_id = $1", [tenant]);
  await admin.query("delete from batches where tenant_id = $1", [tenant]);
  await admin.query("delete from programs where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = any($1)", [[tenant, otherTenant]]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("coach load location scope", () => {
  it("reports every location's coach load when location scoping is OFF", async () => {
    await disableLocationScope();
    const rows = await coachLoad.getCoachLoad(ownerCtx, PERIOD);
    expect(rows.map((r) => r.coachStaffId).sort()).toEqual([coachAStaffId, coachBStaffId].sort());
    expect(rows.find((r) => r.coachStaffId === coachAStaffId)?.coachName).toBe("Coach A");
  });

  it("reports every location's coach load for an unrestricted caller", async () => {
    await enableLocationScope();
    const rows = await coachLoad.getCoachLoad(ownerCtx, PERIOD);
    expect(rows.map((r) => r.coachStaffId).sort()).toEqual([coachAStaffId, coachBStaffId].sort());
  });

  it("reports only the caller's own location's coach load", async () => {
    await enableLocationScope();
    const rows = await coachLoad.getCoachLoad(restrictedCtx, PERIOD);
    expect(rows.map((r) => r.coachStaffId)).toEqual([coachAStaffId]);
    expect(rows[0]?.coachName).toBe("Coach A");
    expect(rows[0]?.sessionCount).toBe(1);
  });

  it("keeps a soft-deleted batch's sessions in the load report (history)", async () => {
    // D-2 (independent review) — the load report counted every session
    // of the period in the base. A batch soft-deleted later must not
    // rewrite what the coaches already taught.
    await disableLocationScope();
    await admin.query("update batches set deleted_at = now() where id = $1", [batchB]);
    try {
      const rows = await coachLoad.getCoachLoad(ownerCtx, PERIOD);
      expect(rows.map((r) => r.coachStaffId).sort()).toEqual(
        [coachAStaffId, coachBStaffId].sort(),
      );

      // D-F2 — the two retained rules together: a soft-deleted batch's
      // sessions survive for a caller whose locations cover that batch,
      // and stay hidden from a caller whose locations do not. History
      // does not widen the location boundary.
      await enableLocationScope();
      const forSiteB = await coachLoad.getCoachLoad(
        { ...restrictedCtx, locationIds: [locB] },
        PERIOD,
      );
      expect(forSiteB.map((r) => r.coachStaffId)).toEqual([coachBStaffId]);

      const forSiteA = await coachLoad.getCoachLoad(restrictedCtx, PERIOD);
      expect(forSiteA.map((r) => r.coachStaffId)).toEqual([coachAStaffId]);
    } finally {
      await admin.query("update batches set deleted_at = null where id = $1", [batchB]);
    }
  });

  it("never reports another tenant's coach load", async () => {
    await enableLocationScope();
    const rows = await coachLoad.getCoachLoad(
      { ...ownerCtx, tenantId: otherTenant },
      PERIOD,
    );
    expect(rows).toEqual([]);
  });
});
