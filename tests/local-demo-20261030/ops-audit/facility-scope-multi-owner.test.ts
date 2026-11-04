// @vitest-environment node
//
// THE MULTI-FACILITY OWNER — what the current model actually does, pinned.
//
// The human's question: "test owner with MULTIPLE FACILITIES, explain the
// current approach". This suite states the current approach as executable
// facts, so the answer cannot drift with the implementation.
//
// The model under test (source-linked in the packet):
//
//   * A FACILITY is a `locations` row of a tenant; a TENANT is the
//     isolation boundary (`db/tenant.ts` sets `app.tenant_id`).
//   * A USER holds a membership per tenant (`tenant_memberships`, unique
//     on tenant+user) — so one person can own more than one club.
//   * A membership's facility reach is `all_locations` (a boolean) plus
//     `membership_locations` (the granted subset).
//   * The facility restriction is a STAFF feature and it is OFF by
//     default: the tenant config key `access.location_scoped_staff`
//     must be true before `resolveLocationAccess` restricts anybody.
//   * There is NO facility switch and NO persisted "current facility":
//     the owner console resolves ONE TENANT (the default membership),
//     not one facility, and every row carries its own location_id.
//
// The cases:
//   1. the owner sees BOTH facilities of their club (all_locations)
//   2. the scoped staff sees only their own facility (key ON)
//   3. the scoped staff's MONEY paths are scoped too (invoice list and
//      invoice by id) — the existing suite only proved members/sessions
//   4. the scoped staff still reaches their OWN facility's invoice
//   5. a cross-tenant target is invisible (direct-action tamper)
//   6. with the key OFF (the shipped default) nothing is restricted
//   7. an owner in two clubs resolves the OLDEST membership's club as
//      the default — the ordering the code documents but does not
//      specify in SQL
//   8. a soft-deleted facility leaves the facility list but keeps its
//      rows visible
//
// RED/known defect: case 7. `db/platform.ts`'s `resolveDefaultMembership`
// orders by `roles.homeOrdinal` alone and takes `limit 1`; two owner
// memberships tie on that column, so the club the owner's console opens
// is decided by the storage order, not by a rule. The sibling resolver
// in `lib/services/location-access.ts` documents the intended order as
// "role home ordinal, then creation" — the SQL does not implement it.
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import * as people from "@/lib/services/people";
import * as invoices from "@/lib/services/invoices";
import * as locations from "@/lib/services/locations";
import * as platform from "@/db/platform";
import { setPlatformTenantConfigValue } from "@/db/config-admin";
import { seedRoleTemplates } from "@/lib/services/roles";

const RUN = Date.now().toString(36);
const KEY = "access.location_scoped_staff" as const;

// The ids are created in this order on purpose: the NEWER membership's
// tenant (B) gets the SMALLER id, so a tenant_id-ordered scan and the
// insertion order both put the newer membership first. The tie must then
// be broken by the membership's AGE, which is the documented rule.
const tenantB = asTenantId(uuidv7());
const tenantA = asTenantId(uuidv7());
// The second owner is the CONTROL of the tie-break test: the same two
// ages, inserted in the opposite order, with the older tenant's id the
// smaller one. Whatever the storage order, both owners must resolve
// their OLDER club — that is what makes the case a genuine test of the
// RULE instead of of one plan's whim.
const tenantD = asTenantId(uuidv7());
const tenantC = asTenantId(uuidv7());
const slugA = `fac-a-${RUN}`;
const slugB = `fac-b-${RUN}`;

const locA = uuidv7();
const locB = uuidv7();
const locC = uuidv7();
const locDeleted = uuidv7();

const ownerUser = asUserId(uuidv7());
const ownerUser2 = asUserId(uuidv7());
const staffUser = asUserId(uuidv7());
const ownerBetterAuth = `ba-owner-${RUN}`;
const ownerBetterAuth2 = `ba-owner2-${RUN}`;
const staffBetterAuth = `ba-staff-${RUN}`;

const ownerMembershipA = uuidv7();
const ownerMembershipB = uuidv7();
const ownerMembershipC = uuidv7();
const ownerMembershipD = uuidv7();
const staffMembership = uuidv7();

const personA = uuidv7();
const personB = uuidv7();
const personC = uuidv7();
const memberA = uuidv7();
const memberB = uuidv7();
const memberC = uuidv7();
// The member of the soft-deleted facility: its row stays in the tenant.
const memberDeleted = uuidv7();
const invoiceA = uuidv7();
const invoiceB = uuidv7();
const invoiceC = uuidv7();
const platformUser = uuidv7();

const ownerCtx = {
  tenantId: tenantA,
  userId: ownerUser,
  allLocations: true,
  locationIds: [],
  roleKey: "owner",
};
const staffCtx = {
  tenantId: tenantA,
  userId: staffUser,
  allLocations: false,
  locationIds: [locA],
  roleKey: "receptionist",
};

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, status) values
       ($1,$2,'Facility A','active'), ($3,$4,'Facility B','active'),
       ($5,$6,'Facility C','active'), ($7,$8,'Facility D','active')`,
    [tenantA, slugA, tenantB, slugB, tenantC, `fac-c-${RUN}`, tenantD, `fac-d-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Worli', true),
       ($2, $3, 'Andheri', false),
       ($4, $5, 'Other Club', true),
       ($6, $3, 'Closed Site', false)`,
    [locA, locB, tenantA, locC, tenantB, locDeleted],
  );
  await seedRoleTemplates(tenantA);
  await seedRoleTemplates(tenantB);
  await seedRoleTemplates(tenantC);
  await seedRoleTemplates(tenantD);

  await admin.query(
    `insert into users (id, phone, better_auth_id) values
       ($1, $3, $4), ($2, $5, $6), ($7, $8, $9)`,
    [
      ownerUser,
      staffUser,
      `+9194${String(Date.now()).slice(-8)}1`,
      ownerBetterAuth,
      `+9194${String(Date.now()).slice(-8)}2`,
      staffBetterAuth,
      ownerUser2,
      `+9194${String(Date.now()).slice(-8)}3`,
      ownerBetterAuth2,
    ],
  );
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'Facility Operator', 'h', 's', 'admin', 'active')`,
    [platformUser, `fac-${RUN}@platform.test`],
  );

  const rolesA = await admin.query<{ id: string; key: string }>(
    "select id, key from roles where tenant_id = $1 and key in ('owner','receptionist')",
    [tenantA],
  );
  const rolesB = await admin.query<{ id: string; key: string; tenant_id: string }>(
    "select id, key, tenant_id from roles where tenant_id in ($1,$2,$3) and key = 'owner'",
    [tenantB, tenantC, tenantD],
  );
  const ownerRoleA = rolesA.rows.find((r) => r.key === "owner")!.id;
  const receptionRoleA = rolesA.rows.find((r) => r.key === "receptionist")!.id;
  const ownerRoleFor = (tenant: string) =>
    rolesB.rows.find((r) => r.tenant_id === tenant)!.id;
  const ownerRoleB = ownerRoleFor(tenantB);
  const ownerRoleC = ownerRoleFor(tenantC);
  const ownerRoleD = ownerRoleFor(tenantD);

  // The owner's membership in club A is the OLDER one (two days). The
  // fixture is built so that EVERY plausible physical order of the two
  // owner memberships puts the NEWER one first: it is inserted first, and
  // its tenant id is the smaller one (so a tenant_id-ordered scan agrees).
  //
  // The documented default order is "role home ordinal, then creation"
  // (lib/services/location-access.ts mirrors it with
  // asc(roles.homeOrdinal), asc(tenantMemberships.createdAt)), so the
  // OLDER membership must win. `db/platform.ts` orders by homeOrdinal
  // alone, so the tie is broken by the storage order — this case is the
  // RED for that.
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status, created_at)
     values ($2, $5, $4, $8, true, 'active', now()),
            ($1, $3, $4, $7, true, 'active', now() - interval '2 days'),
            ($6, $3, $9, $10, false, 'active', now()),
            ($11, $12, $13, $14, true, 'active', now() - interval '2 days'),
            ($15, $16, $13, $17, true, 'active', now())`,
    [
      ownerMembershipB,
      ownerMembershipA,
      tenantA,
      ownerUser,
      tenantB,
      staffMembership,
      ownerRoleA,
      ownerRoleB,
      staffUser,
      receptionRoleA,
      ownerMembershipD,
      tenantD,
      ownerUser2,
      ownerRoleD,
      ownerMembershipC,
      tenantC,
      ownerRoleC,
    ],
  );
  await admin.query(
    `insert into membership_locations (id, tenant_id, membership_id, location_id)
     values ($1, $2, $3, $4)`,
    [uuidv7(), tenantA, staffMembership, locA],
  );

  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $3, 'Worli Person'), ($2, $3, 'Andheri Person'), ($4, $5, 'Other Club Person')`,
    [personA, personB, tenantA, personC, tenantB],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code) values
       ($1, $3, $5, $7, 'active', $9),
       ($2, $3, $6, $8, 'active', $10),
       ($4, $11, $12, $13, 'active', $14),
       ($15, $3, $5, $16, 'active', $17)`,
    [
      memberA,
      memberB,
      tenantA,
      memberC,
      personA,
      personB,
      locA,
      locB,
      `FAC-A-${RUN}`,
      `FAC-B-${RUN}`,
      tenantB,
      personC,
      locC,
      `FAC-C-${RUN}`,
      memberDeleted,
      locDeleted,
      `FAC-D-${RUN}`,
    ],
  );
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number, financial_year,
                           issued_on, due_on, subtotal_paise, tax_paise, total_paise, status, source)
     values ($1, $3, $5, $7, $9, '2026-27', '2026-09-20', '2026-09-21', 100000, 18000, 118000, 'issued', 'membership'),
            ($2, $3, $6, $8, $10, '2026-27', '2026-09-20', '2026-09-21', 100000, 18000, 118000, 'issued', 'membership'),
            ($4, $11, $12, $13, $14, '2026-27', '2026-09-20', '2026-09-21', 100000, 18000, 118000, 'issued', 'membership')`,
    [
      invoiceA,
      invoiceB,
      tenantA,
      invoiceC,
      locA,
      locB,
      memberA,
      memberB,
      `FA-${RUN}`,
      `FB-${RUN}`,
      tenantB,
      locC,
      memberC,
      `FC-${RUN}`,
    ],
  );
  // The facility the owner "closed": soft-deleted, so it leaves every
  // facility list, but the rows that reference it stay in the tenant.
  await admin.query(
    "update locations set deleted_at = now() where id = $1",
    [locDeleted],
  );
});

afterAll(async () => {
  await admin.query(
    "delete from platform_audit_log where actor_id = $1",
    [platformUser],
  );
  await admin.query(
    "delete from invoices where tenant_id in ($1,$2,$3,$4)",
    [tenantA, tenantB, tenantC, tenantD],
  );
  await admin.query(
    "delete from members where tenant_id in ($1,$2,$3,$4)",
    [tenantA, tenantB, tenantC, tenantD],
  );
  await admin.query(
    "delete from persons where tenant_id in ($1,$2,$3,$4)",
    [tenantA, tenantB, tenantC, tenantD],
  );
  await admin.query("delete from membership_locations where tenant_id = $1", [
    tenantA,
  ]);
  await admin.query(
    "delete from tenant_memberships where tenant_id in ($1,$2,$3,$4)",
    [tenantA, tenantB, tenantC, tenantD],
  );
  await admin.query(
    "delete from locations where tenant_id in ($1,$2,$3,$4)",
    [tenantA, tenantB, tenantC, tenantD],
  );
  await admin.query(
    "delete from role_permissions where tenant_id in ($1,$2,$3,$4)",
    [tenantA, tenantB, tenantC, tenantD],
  );
  await admin.query("delete from roles where tenant_id in ($1,$2,$3,$4)", [
    tenantA,
    tenantB,
    tenantC,
    tenantD,
  ]);
  await admin.query("delete from tenants where id in ($1,$2,$3,$4)", [
    tenantA,
    tenantB,
    tenantC,
    tenantD,
  ]);
  await admin.query("delete from platform_users where id = $1", [platformUser]);
  await admin.query("delete from users where id in ($1,$2,$3)", [
    ownerUser,
    staffUser,
    ownerUser2,
  ]);
  await admin.end();
});

describe("the multi-facility owner", () => {
  it("sees every facility of their club", async () => {
    const members = await people.listMembers(ownerCtx, {});
    expect(
      members.map((m) => m.memberId).sort(),
      "an owner must see both facilities of their club",
    ).toEqual([memberA, memberB, memberDeleted].sort());
  });

  it("reaches the other facility's invoice", async () => {
    const rows = await invoices.listMemberInvoices(ownerCtx, memberB);
    expect(rows).toHaveLength(1);
    expect(await invoices.getInvoice(ownerCtx, invoiceB)).not.toBeNull();
  });

  it("resolves the OLDEST membership's club as the default club — for BOTH owners, whatever the insertion order", async () => {
    // Owner 1's memberships are inserted newer-first (and the newer
    // tenant's id is the smaller one), so every physical order puts the
    // NEWER membership first. Owner 2's are the mirror image: the older
    // membership is inserted first and its tenant has the smaller id.
    // The RULE (role home ordinal, then creation) must give both owners
    // their OLDER club. An implementation that breaks the tie by the
    // storage order answers differently for the two owners, and this case
    // is the RED for that.
    const first = await platform.resolveDefaultMembership(ownerBetterAuth);
    const second = await platform.resolveDefaultMembership(ownerBetterAuth2);
    expect(first, "the first owner must resolve a club").not.toBeNull();
    expect(second, "the second owner must resolve a club").not.toBeNull();
    expect(
      first!.tenantId,
      "the first owner's default club must be their OLDEST membership, not the one the storage order returned first",
    ).toBe(tenantA);
    expect(
      second!.tenantId,
      "the second owner's default club must be their OLDEST membership too",
    ).toBe(tenantD);
  });

  it("resolves the OLDEST membership's club as the default club", async () => {
    // The documented order is "role home ordinal, then creation"
    // (lib/services/location-access.ts mirrors it). Both owner
    // memberships tie on homeOrdinal, so the tie must be broken by the
    // membership's age — the owner's oldest club.
    const resolved = await platform.resolveDefaultMembership(ownerBetterAuth);
    expect(resolved, "the owner's default club must resolve").not.toBeNull();
    expect(
      resolved!.tenantId,
      "the default club must be the owner's OLDEST membership, not whichever row the storage order returned first",
    ).toBe(tenantA);
  });

  it("resolves each club by its slug and refuses a club the owner is not in", async () => {
    expect(
      (await platform.resolveTenantAccessBySlug(ownerBetterAuth, slugA))
        ?.tenantId,
    ).toBe(tenantA);
    expect(
      (await platform.resolveTenantAccessBySlug(ownerBetterAuth, slugB))
        ?.tenantId,
    ).toBe(tenantB);
    expect(
      await platform.resolveTenantAccessBySlug(staffBetterAuth, slugB),
      "a staff member of another club must resolve nothing there",
    ).toBeNull();
  });
});

describe("the facility scope is a staff feature and it is off by default", () => {
  it("restricts nothing while the key is off (the shipped default)", async () => {
    const members = await people.listMembers(staffCtx, {});
    expect(
      members.map((m) => m.memberId).sort(),
      "with the key off the staff member sees the whole tenant",
    ).toEqual([memberA, memberB, memberDeleted].sort());
  });
});

describe("with the facility scope on", () => {
  beforeAll(async () => {
    const enabled = await setPlatformTenantConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: true,
      actorId: asUserId(platformUser),
    });
    expect(enabled.ok, "the facility scope must be switchable").toBe(true);
  });

  it("restricts the staff member to their own facility", async () => {
    const members = await people.listMembers(staffCtx, {});
    expect(members.map((m) => m.memberId)).toEqual([memberA]);
    expect(await people.getMemberDetail(staffCtx, memberB)).toBeNull();
  });

  it("restricts the MONEY paths too: another facility's invoice is neither listed nor reachable", async () => {
    expect(
      await invoices.listMemberInvoices(staffCtx, memberB),
      "the other facility's invoice must not be listed",
    ).toHaveLength(0);
    expect(
      await invoices.getInvoice(staffCtx, invoiceB),
      "the other facility's invoice must not be reachable by id",
    ).toBeNull();
  });

  it("still reaches its own facility's invoice", async () => {
    expect(await invoices.listMemberInvoices(staffCtx, memberA)).toHaveLength(1);
    expect(await invoices.getInvoice(staffCtx, invoiceA)).not.toBeNull();
  });
});

describe("the tenant boundary holds across facilities", () => {
  it("cannot see another club's invoice, member or facility", async () => {
    expect(await invoices.getInvoice(ownerCtx, invoiceC)).toBeNull();
    expect(await people.getMemberDetail(ownerCtx, memberC)).toBeNull();
    const facilityList = await locations.listAdminLocations(ownerCtx);
    expect(facilityList.map((l) => l.id)).not.toContain(locC);
  });
});

describe("a soft-deleted facility", () => {
  it("leaves the facility list but keeps its rows in the tenant", async () => {
    const facilityList = await locations.listAdminLocations(ownerCtx);
    expect(
      facilityList.map((l) => l.id),
      "a deleted facility must not be offered",
    ).not.toContain(locDeleted);
    expect(facilityList.map((l) => l.id).sort()).toEqual([locA, locB].sort());
    const members = await people.listMembers(ownerCtx, {});
    expect(
      members.map((m) => m.memberId),
      "the rows of a deleted facility stay in the tenant",
    ).toContain(memberDeleted);
  });
});
