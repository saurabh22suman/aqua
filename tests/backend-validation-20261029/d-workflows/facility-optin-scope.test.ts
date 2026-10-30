import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
// The privileged pool is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only. Every assertion below runs against the application's own
// service, which connects as `app_login` under tenant RLS.
import { asTenantId, asUserId } from "@/lib/ids";

// DEF-05 — a member's facility opt-in is a location-scoped write.
//
// `addMemberFacility` / `endMemberFacility` check only that the member and
// the location belong to the tenant. They never resolve the CALLER's
// location access, so with `access.location_scoped_staff` on, a
// receptionist attached to Site A can opt a member into Site B's facility
// and end an opt-in that belongs to another site.
//
// The sibling rule is already established in this codebase:
//   * lib/services/member-registration.ts:34 refuses a member registration
//     at a location outside the caller's scope;
//   * lib/services/shifts.ts:60 refuses a shift at a location outside it;
//   * lib/services/bookings.ts:116 refuses a facility outside it.
//
// The refusal shape is the established one: an out-of-scope row is
// reported as "not found", never as "forbidden", so the caller learns
// nothing about whether it exists.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const memberA = uuidv7();
const memberB = uuidv7();
const personA = uuidv7();
const personB = uuidv7();
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

let optins: typeof import("@/lib/services/facility-optins");

async function optinRows(): Promise<{ id: string; member_id: string; location_id: string }[]> {
  const { rows } = await admin.query<{ id: string; member_id: string; location_id: string }>(
    "select id, member_id, location_id from member_facility_optins where tenant_id = $1",
    [tenant],
  );
  return rows;
}

beforeAll(async () => {
  optins = await import("@/lib/services/facility-optins");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Optin Scope', 'active', $3)",
    [tenant, `d-optin-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true), ($3, $2, 'Site B', false)",
    [locA, tenant, locB],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $3, 'Member A', '1990-01-01'), ($2, $3, 'Member B', '1990-01-01')",
    [personA, personB, tenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $3, $4, $5, $6, 'active'), ($2, $3, $7, $8, $9, 'active')",
    [memberA, memberB, tenant, personA, locA, `OPT-A-${RUN}`, personB, locB, `OPT-B-${RUN}`],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9196${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into config_values (key, scope_type, scope_id, tenant_id, value)
     values ('access.location_scoped_staff', 'tenant', $1, $2, 'true'::jsonb)
     on conflict do nothing`,
    [tenant, tenant],
  );
}, 60_000);

afterAll(async () => {
  await admin.query("delete from member_facility_optins where tenant_id = $1", [tenant]);
  await admin.query("delete from config_values where tenant_id = $1", [tenant]);
  await admin.query("delete from members where tenant_id = $1", [tenant]);
  await admin.query("delete from persons where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("DEF-05 facility opt-in location scope", () => {
  it("refuses to opt a member into another location's facility", async () => {
    const result = await optins.addMemberFacility(restrictedCtx, {
      memberId: memberA,
      locationId: locB,
    });
    expect(result.ok).toBe(false);
    expect(await optinRows()).toEqual([]);
  });

  it("refuses to opt another location's member into a facility", async () => {
    const result = await optins.addMemberFacility(restrictedCtx, {
      memberId: memberB,
      locationId: locA,
    });
    expect(result.ok).toBe(false);
    expect(await optinRows()).toEqual([]);
  });

  it("still opts a member into a facility at the caller's own location", async () => {
    const result = await optins.addMemberFacility(restrictedCtx, {
      memberId: memberA,
      locationId: locA,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.locationId).toBe(locA);
    expect((await optinRows()).length).toBe(1);
  });

  it("refuses to end another location's opt-in", async () => {
    const created = await optins.addMemberFacility(ownerCtx, {
      memberId: memberB,
      locationId: locB,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const attempt = await optins.endMemberFacility(restrictedCtx, {
      optinId: created.row.optinId,
    });
    expect(attempt.ok).toBe(false);

    const rows = await optinRows();
    expect(rows.length).toBe(2);
    const { rows: stillOpen } = await admin.query<{ n: string }>(
      "select count(*)::text as n from member_facility_optins where tenant_id = $1 and ended_on is null",
      [tenant],
    );
    expect(Number(stillOpen[0]?.n)).toBe(2);
  });

  it("lets an unrestricted owner manage opt-ins at every location", async () => {
    const created = await optins.addMemberFacility(ownerCtx, {
      memberId: memberA,
      locationId: locB,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ended = await optins.endMemberFacility(ownerCtx, {
      optinId: created.row.optinId,
    });
    expect(ended.ok).toBe(true);
  });
});
