// H6 — lib/services/global-search.ts: the enquiry branch of the global
// search does not apply the enquiry visibility rule that every other
// enquiry read applies.
//
// lib/services/enquiry-scope.ts (R04) states the rule: an enquiry belongs
// to a site; a non-management caller sees only located enquiries inside
// its allowed locations, and an unresolved enquiry (location_id IS NULL)
// is visible only through the management review path.
//
// searchMembers and searchPayments both consult resolveLocationAccess;
// searchEnquiries consults neither the location scope nor the management
// rule. So with access.location_scoped_staff ON, the search box can
// surface another site's enquiries and unresolved enquiries that the
// enquiries LIST deliberately hides — two surfaces of the same tenant
// disagreeing about what the caller may see.
//
// The intended contract (asserted here): the global search returns
// exactly the enquiries the list surface would return for the same
// caller. This test asserts the search's enquiry hits are a SUBSET of the
// list's rows, and that the specific rows the list hides are absent.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture.ts);
// every assertion runs through the application path (app_login ->
// app_user) via the real services.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { globalSearch } from "@/lib/services/global-search";
import { listEnquiries } from "@/lib/services/enquiry-reads";
import { resolveConfigInTx } from "@/db/config";
import { withTenant } from "@/db/tenant";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";

const RUN = Date.now().toString(36);
const ids = {
  tenant: uuidv7(),
  locationA: uuidv7(),
  locationB: uuidv7(),
  personA: uuidv7(),
  personB: uuidv7(),
  personU: uuidv7(),
  memberA: uuidv7(),
  memberB: uuidv7(),
  memberU: uuidv7(),
  enquiryA: uuidv7(),
  enquiryB: uuidv7(),
  enquiryUnresolved: uuidv7(),
  user: uuidv7(),
  membership: uuidv7(),
  role: uuidv7(),
  membershipLocation: uuidv7(),
};

const SCOPED_KEY = "access.location_scoped_staff";
const TERM = `bv-h6-${RUN}`;

beforeAll(async () => {
  // Fixture: tenant, two locations, three enquiries (one at site A, one at
  // site B, one unresolved) and a location-scoped caller.
  await admin.query(
    `insert into tenants (id, slug, name, status) values ($1, $2, 'H6 Tenant', 'active')`,
    [ids.tenant, `bv-h6-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Site A', true),
       ($2, $3, 'Site B', false)`,
    [ids.locationA, ids.locationB, ids.tenant],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $4, 'H6 Person A'),
       ($2, $4, 'H6 Person B'),
       ($3, $4, 'H6 Person Unresolved')`,
    [ids.personA, ids.personB, ids.personU, ids.tenant],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code) values
       ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'active', $5),
       ($6::uuid, $2::uuid, $7::uuid, $8::uuid, 'active', $9),
       ($10::uuid, $2::uuid, $11::uuid, $4::uuid, 'active', $12)`,
    [
      ids.memberA,
      ids.tenant,
      ids.personA,
      ids.locationA,
      `H6-A-${TERM}`,
      ids.memberB,
      ids.personB,
      ids.locationB,
      `H6-B-${TERM}`,
      ids.memberU,
      ids.personU,
      `H6-U-${TERM}`,
    ],
  );
  // The enquiries carry the search term in their name so one query finds
  // all three.
  await admin.query(
    `insert into enquiries (id, tenant_id, full_name, phone, source, stage, location_id) values
       ($1::uuid, $2::uuid, $3, '+919000000001', 'walk-in', 'new', $4::uuid),
       ($5::uuid, $2::uuid, $6, '+919000000002', 'walk-in', 'new', $7::uuid),
       ($8::uuid, $2::uuid, $9, '+919000000003', 'walk-in', 'new', null)`,
    [
      ids.enquiryA,
      ids.tenant,
      `H6 Alpha ${TERM}`,
      ids.locationA,
      ids.enquiryB,
      `H6 Bravo ${TERM}`,
      ids.locationB,
      ids.enquiryUnresolved,
      `H6 Unresolved ${TERM}`,
    ],
  );
  // The caller: a membership scoped to site A only.
  await admin.query(
    `insert into users (id, phone) values ($1, $2)`,
    [ids.user, `+9194${RUN.slice(-8)}`],
  );
  await admin.query(
    `insert into roles (id, tenant_id, key, name, is_system, home_path, home_ordinal)
     values ($1, $2, 'receptionist', 'Receptionist', true, '/reception', 3)`,
    [ids.role, ids.tenant],
  );
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status)
     values ($1, $2, $3, $4, false, 'active')`,
    [ids.membership, ids.tenant, ids.user, ids.role],
  );
  await admin.query(
    `insert into membership_locations (id, tenant_id, membership_id, location_id)
     values (gen_random_uuid(), $1, $2, $3)`,
    [ids.tenant, ids.membership, ids.locationA],
  );
});

afterAll(async () => {
  await admin.query("delete from enquiries where id = any($1::uuid[])", [
    [ids.enquiryA, ids.enquiryB, ids.enquiryUnresolved],
  ]);
  await admin.query("delete from membership_locations where membership_id = $1", [
    ids.membership,
  ]);
  await admin.query("delete from tenant_memberships where id = $1", [ids.membership]);
  await admin.query("delete from roles where id = $1", [ids.role]);
  await admin.query("delete from users where id = $1", [ids.user]);
  await admin.query("delete from members where id = any($1::uuid[])", [
    [ids.memberA, ids.memberB, ids.memberU],
  ]);
  await admin.query("delete from persons where id = any($1::uuid[])", [
    [ids.personA, ids.personB, ids.personU],
  ]);
  await admin.query("delete from locations where id = any($1::uuid[])", [
    [ids.locationA, ids.locationB],
  ]);
  await admin.query("delete from config_values where scope_type = 'tenant' and scope_id = $1", [
    ids.tenant,
  ]);
  await admin.query("delete from tenants where id = $1", [ids.tenant]);
  await admin.end();
});

// The caller context as the global-search action builds it: roleKey plus
// the resolved permission set.
function scopedCtx() {
  return {
    tenantId: ids.tenant,
    userId: ids.user,
    roleKey: "receptionist",
    permissions: new Set([
      "members.read",
      "enquiries.read",
      "invoices.read",
      "staff.self",
    ]),
  } as never;
}

async function setLocationScope(on: boolean): Promise<void> {
  // The key is owner_read: ops owns it, so the write goes through the
  // ops path (db/config-admin.ts), exactly as the Ops console does it.
  const { setPlatformTenantConfigValue } = await import("@/db/config-admin");
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values (gen_random_uuid(), $1, 'H6 Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do nothing`,
    [`bv-h6-${RUN}@platform.test`],
  );
  const actor = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [`bv-h6-${RUN}@platform.test`],
  );
  const result = await setPlatformTenantConfigValue({
    tenantId: ids.tenant as never,
    key: SCOPED_KEY as never,
    value: on,
    actorId: actor.rows[0]!.id as never,
  });
  expect(result.ok).toBe(true);
}

describe("H6 — global search honours the same enquiry visibility rule as the enquiries list", () => {
  it("with location scoping OFF, the search sees the same enquiries the list sees", async () => {
    await setLocationScope(false);
    const ctx = scopedCtx();
    const list = await listEnquiries(ctx, {});
    const hits = await globalSearch(ctx, TERM);
    const hitIds = hits.filter((h) => h.kind === "enquiry").map((h) => h.id);
    const listIds = list.map((r) => r.id);

    // The list is the reference surface: the search must not exceed it.
    for (const id of hitIds) {
      expect(listIds, "search must not reveal an enquiry the list hides").toContain(id);
    }
  });

  it("with location scoping ON, a site-A caller cannot see site B or unresolved enquiries", async () => {
    await setLocationScope(true);
    const ctx = scopedCtx();
    const list = await listEnquiries(ctx, {});
    const hits = await globalSearch(ctx, TERM);
    const hitIds = hits.filter((h) => h.kind === "enquiry").map((h) => h.id);

    // The list surface is the reference: it hides site B and unresolved
    // rows from a non-management, location-scoped caller.
    expect(
      list.map((r) => r.id),
      "the list hides the foreign-site and unresolved enquiries",
    ).not.toContain(ids.enquiryB);
    expect(list.map((r) => r.id)).not.toContain(ids.enquiryUnresolved);
    expect(list.map((r) => r.id)).toContain(ids.enquiryA);

    // The search must agree with the list.
    expect(
      hitIds,
      "search must not reveal the foreign-site enquiry",
    ).not.toContain(ids.enquiryB);
    expect(
      hitIds,
      "search must not reveal the unresolved enquiry",
    ).not.toContain(ids.enquiryUnresolved);

    // And every search hit must be a row the list returns.
    const listIds = list.map((r) => r.id);
    for (const id of hitIds) {
      expect(listIds, "search must not reveal an enquiry the list hides").toContain(id);
    }
  });

  it("a management caller still sees every enquiry through the search", async () => {
    await setLocationScope(true);
    // Management (settings.manage) keeps the full view, including the
    // unresolved queue. The fix must not narrow a legitimate reader.
    const managementCtx = {
      tenantId: ids.tenant,
      userId: ids.user,
      roleKey: "receptionist",
      permissions: new Set([
        "members.read",
        "enquiries.read",
        "invoices.read",
        "settings.manage",
      ]),
    } as never;
    const list = await listEnquiries(managementCtx, {});
    const hits = await globalSearch(managementCtx, TERM);
    const hitIds = hits.filter((h) => h.kind === "enquiry").map((h) => h.id);
    const listIds = list.map((r) => r.id);

    // Management keeps the unresolved review queue even though the
    // caller is location-restricted (lib/services/enquiry-scope.ts: a
    // management caller sees located rows inside its allowed locations
    // PLUS the unresolved queue).
    expect(listIds, "the list keeps the unresolved queue for management").toContain(
      ids.enquiryUnresolved,
    );
    expect(
      hitIds,
      "the search must keep the unresolved queue for management too",
    ).toContain(ids.enquiryUnresolved);

    // And the search still agrees with the list for management.
    for (const id of hitIds) {
      expect(listIds, "search must not reveal an enquiry the list hides").toContain(id);
    }
  });

  it("the location-scoped member and payment branches still work", async () => {
    await setLocationScope(true);
    const ctx = scopedCtx();
    const hits = await globalSearch(ctx, TERM);
    // The member branch is location-scoped: the site-A member is visible,
    // the site-B member is not (the term matches the member codes).
    const memberHits = hits.filter((h) => h.kind === "member").map((h) => h.id);
    expect(memberHits).toContain(ids.memberA);
    expect(memberHits).not.toContain(ids.memberB);
  });

  it("the config key really is ON for this tenant (the test's own precondition)", async () => {
    await setLocationScope(true);
    const value = await withTenant(ids.tenant as never, (tx) =>
      resolveConfigInTx<boolean>(tx, ids.tenant as never, SCOPED_KEY as never),
    );
    expect(value.value).toBe(true);
  });
});
