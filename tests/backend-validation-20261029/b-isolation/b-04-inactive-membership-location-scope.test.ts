// Inactive-membership location fallback — lib/services/location-access.ts.
//
// resolveLocationAccess's fallback query (used whenever a caller narrows
// the ctx and therefore does not carry the authoritative allLocations /
// locationIds) selects the caller's membership row filtering only
// `deletedAt IS NULL` — NOT `status = 'active'`.
//
// The documented rule is that a REVOKED membership grants no access
// (lib/services/resource-access.ts and db/platform.ts both resolve a
// membership with status = 'active'). The fallback therefore decides on
// a revoked row's own terms: a revoked membership with all_locations =
// true answers "unrestricted", which is exactly the widening the rule
// forbids.
//
// Reachability of the fallback: action adapters that narrow the ctx to
// { tenantId, userId } (e.g. lib/actions/people.ts) drop allLocations and
// locationIds, so resolveLocationAccess takes the DB fallback path with
// the caller's own membership as the only input.
//
// This file asserts the rule on the decision point itself:
//   - a REVOKED membership grants no access (neither unrestricted nor
//     location rows),
//   - an ACTIVE all-locations membership is unrestricted,
//   - an ACTIVE location-scoped membership is scoped to its locations,
//   - with the feature OFF the caller is unrestricted (tenant-wide is
//     today's default behaviour),
//   - a revoked membership in ANOTHER tenant cannot widen the caller's
//     access in the tenant they actually belong to.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture.ts);
// every assertion runs through the application path (app_login ->
// app_user) via withTenant + resolveLocationAccess.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { resolveConfigInTx } from "@/db/config";
import { resolveLocationAccess } from "@/lib/services/location-access";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";

const RUN = Date.now().toString(36);
const SCOPED_KEY = "access.location_scoped_staff";

const ids = {
  tenant: uuidv7(),
  otherTenant: uuidv7(),
  location: uuidv7(),
  role: uuidv7(),
  activeUser: uuidv7(),
  activeMembership: uuidv7(),
  revokedUser: uuidv7(),
  revokedMembership: uuidv7(),
  activeAllUser: uuidv7(),
  activeAllMembership: uuidv7(),
  otherRevokedUser: uuidv7(),
  otherRevokedMembership: uuidv7(),
  membershipLocation: uuidv7(),
};

let activeMembershipId: string;
let revokedMembershipId: string;

async function setLocationScope(on: boolean): Promise<void> {
  const { setPlatformTenantConfigValue } = await import("@/db/config-admin");
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values (gen_random_uuid(), $1, 'Inactive Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do nothing`,
    [`bv-inactive-${RUN}@platform.test`],
  );
  const actor = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [`bv-inactive-${RUN}@platform.test`],
  );
  const result = await setPlatformTenantConfigValue({
    tenantId: ids.tenant as never,
    key: SCOPED_KEY as never,
    value: on,
    actorId: actor.rows[0]!.id as never,
  });
  expect(result.ok).toBe(true);
}

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, status) values
       ($1, $2, 'Inactive Tenant', 'active'),
       ($3, $4, 'Inactive Other Tenant', 'active')`,
    [ids.tenant, `bv-inactive-${RUN}`, ids.otherTenant, `bv-inactive-other-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true)`,
    [ids.location, ids.tenant],
  );
  await admin.query(
    `insert into roles (id, tenant_id, key, name, is_system, home_path, home_ordinal)
     values ($1, $2, 'receptionist', 'Receptionist', true, '/reception', 3)`,
    [ids.role, ids.tenant],
  );

  // (1) ACTIVE, location-scoped membership.
  await admin.query(
    `insert into users (id, phone) values
       ($1, $2), ($3, $4), ($5, $6), ($7, $8)`,
    [
      ids.activeUser,
      `+9191${RUN.slice(-7)}1`,
      ids.revokedUser,
      `+9191${RUN.slice(-7)}2`,
      ids.activeAllUser,
      `+9191${RUN.slice(-7)}3`,
      ids.otherRevokedUser,
      `+9191${RUN.slice(-7)}4`,
    ],
  );
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status) values
       ($1, $2, $3, $4, false, 'active'),
       ($5, $2, $6, $4, true,  'revoked'),
       ($7, $2, $8, $4, true,  'active')`,
    [
      ids.activeMembership,
      ids.tenant,
      ids.activeUser,
      ids.role,
      ids.revokedMembership,
      ids.revokedUser,
      ids.activeAllMembership,
      ids.activeAllUser,
    ],
  );
  activeMembershipId = ids.activeMembership;
  revokedMembershipId = ids.revokedMembership;
  await admin.query(
    `insert into membership_locations (id, tenant_id, membership_id, location_id)
     values (gen_random_uuid(), $1, $2, $3)`,
    [ids.tenant, ids.activeMembership, ids.location],
  );

  // (2) A REVOKED membership in ANOTHER tenant, all_locations = true.
  await admin.query(
    `insert into roles (id, tenant_id, key, name, is_system, home_path, home_ordinal)
     values ($1, $2, 'receptionist', 'Receptionist', true, '/reception', 3)`,
    [uuidv7(), ids.otherTenant],
  );
  const otherRole = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1 limit 1",
    [ids.otherTenant],
  );
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status)
     values ($1, $2, $3, $4, true, 'revoked')`,
    [ids.otherRevokedMembership, ids.otherTenant, ids.otherRevokedUser, otherRole.rows[0]!.id],
  );
});

afterAll(async () => {
  await admin.query("delete from membership_locations where membership_id = $1", [
    ids.activeMembership,
  ]);
  await admin.query(
    "delete from tenant_memberships where id = any($1::uuid[])",
    [[ids.activeMembership, ids.revokedMembership, ids.activeAllMembership, ids.otherRevokedMembership]],
  );
  await admin.query("delete from roles where tenant_id = any($1::uuid[])", [
    [ids.tenant, ids.otherTenant],
  ]);
  await admin.query("delete from users where id = any($1::uuid[])", [
    [ids.activeUser, ids.revokedUser, ids.activeAllUser, ids.otherRevokedUser],
  ]);
  await admin.query("delete from locations where id = $1", [ids.location]);
  await admin.query("delete from config_values where scope_type = 'tenant' and scope_id = $1", [
    ids.tenant,
  ]);
  await admin.query("delete from tenants where id = any($1::uuid[])", [
    [ids.tenant, ids.otherTenant],
  ]);
  await admin.end();
});

// The narrowed-ctx shape an action adapter produces: tenantId + userId,
// no authoritative allLocations / locationIds, so resolveLocationAccess
// must decide from the database.
function narrowedCtx(tenantId: string, userId: string) {
  return {
    tenantId,
    userId,
    roleKey: "receptionist",
  } as never;
}

describe("inactive membership grants no location access", () => {
  it("a REVOKED all-locations membership does not make the caller unrestricted", async () => {
    await setLocationScope(true);
    const access = await withTenant(ids.tenant as never, (tx) =>
      resolveLocationAccess(tx, narrowedCtx(ids.tenant, ids.revokedUser)),
    );
    expect(
      access,
      "a revoked membership must not grant unrestricted access",
    ).toEqual({ unrestricted: false, locationIds: [] });
  });

  it("a REVOKED membership's location rows are not honoured either", async () => {
    await setLocationScope(true);
    // Give the revoked membership a location row of its own: it must
    // still grant nothing.
    await admin.query(
      `insert into membership_locations (id, tenant_id, membership_id, location_id)
       values (gen_random_uuid(), $1, $2, $3)`,
      [ids.tenant, ids.revokedMembership, ids.location],
    );
    try {
      const access = await withTenant(ids.tenant as never, (tx) =>
        resolveLocationAccess(tx, narrowedCtx(ids.tenant, ids.revokedUser)),
      );
      expect(access).toEqual({ unrestricted: false, locationIds: [] });
    } finally {
      await admin.query(
        "delete from membership_locations where membership_id = $1",
        [ids.revokedMembership],
      );
    }
  });

  it("an ACTIVE all-locations membership is unrestricted (legitimate positive control)", async () => {
    await setLocationScope(true);
    const access = await withTenant(ids.tenant as never, (tx) =>
      resolveLocationAccess(tx, narrowedCtx(ids.tenant, ids.activeAllUser)),
    );
    expect(access).toEqual({ unrestricted: true });
  });

  it("an ACTIVE location-scoped membership is scoped to its locations (legitimate positive control)", async () => {
    await setLocationScope(true);
    const access = await withTenant(ids.tenant as never, (tx) =>
      resolveLocationAccess(tx, narrowedCtx(ids.tenant, ids.activeUser)),
    );
    expect(access).toEqual({
      unrestricted: false,
      locationIds: [ids.location],
    });
  });

  it("with the feature OFF the caller is unrestricted (today's tenant-wide default)", async () => {
    await setLocationScope(false);
    const access = await withTenant(ids.tenant as never, (tx) =>
      resolveLocationAccess(tx, narrowedCtx(ids.tenant, ids.activeUser)),
    );
    expect(access).toEqual({ unrestricted: true });
    // The feature really is off.
    const value = await withTenant(ids.tenant as never, (tx) =>
      resolveConfigInTx<boolean>(tx, ids.tenant as never, SCOPED_KEY as never),
    );
    expect(value.value).toBe(false);
  });

  it("a revoked membership in ANOTHER tenant cannot widen access in the caller's own tenant", async () => {
    await setLocationScope(true);
    const access = await withTenant(ids.tenant as never, (tx) =>
      resolveLocationAccess(tx, narrowedCtx(ids.tenant, ids.activeUser)),
    );
    expect(access).toEqual({ unrestricted: false, locationIds: [ids.location] });
  });

  it("an authoritative resolved context is authoritative (never re-derived)", async () => {
    await setLocationScope(true);
    // The request path passes the RESOLVED allLocations/locationIds; the
    // fallback must not be consulted, and a revoked membership row must
    // not override the resolved answer either.
    const access = await withTenant(ids.tenant as never, (tx) =>
      resolveLocationAccess(tx, {
        tenantId: ids.tenant,
        userId: ids.revokedUser,
        roleKey: "receptionist",
        allLocations: false,
        locationIds: [ids.location],
      } as never),
    );
    expect(access).toEqual({ unrestricted: false, locationIds: [ids.location] });
  });

  it("an internal system path stays unrestricted (no user identity)", async () => {
    await setLocationScope(true);
    const access = await withTenant(ids.tenant as never, (tx) =>
      resolveLocationAccess(tx, {
        tenantId: ids.tenant,
        systemActor: true,
      } as never),
    );
    expect(access).toEqual({ unrestricted: true });
  });

  it("the fixture really contains a revoked all-locations membership in this tenant", async () => {
    const { rows } = await admin.query<{ status: string; all_locations: boolean }>(
      "select status, all_locations from tenant_memberships where id = $1",
      [revokedMembershipId],
    );
    expect(rows[0]).toEqual({ status: "revoked", all_locations: true });
    // And the active scoped membership is present with its location row.
    const { rows: scoped } = await admin.query<{ status: string; all_locations: boolean }>(
      "select status, all_locations from tenant_memberships where id = $1",
      [activeMembershipId],
    );
    expect(scoped[0]).toEqual({ status: "active", all_locations: false });
    const { rows: locs } = await admin.query<{ n: number }>(
      "select count(*)::int as n from membership_locations where membership_id = $1",
      [activeMembershipId],
    );
    expect(locs[0]!.n).toBe(1);
  });
});
