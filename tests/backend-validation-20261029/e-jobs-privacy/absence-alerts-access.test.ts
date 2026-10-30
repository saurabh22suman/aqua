// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F1 — the absence-alert list must be scoped to the CALLER'S RESOURCES,
// not just to the caller's tenant.
//
// The bug: lib/services/absence-alerts.ts listMemberAlerts() filtered
// only on (tenant_id, member_id). The action that calls it
// (lib/actions/absence-alerts.ts listMemberAlertsAction) requires the
// permission `members.read.assigned`, whose own catalogue description
// is "View only members assigned to the coach's own batches"
// (db/seed-platform.ts). The sibling coach read
// (lib/actions/coach.ts getCoachMemberDetailAction ->
// lib/services/coach-member.ts getCoachMemberDetail) enforces that
// with visibleMember(); the absence-alert read did not.
//
// The page that renders the alerts
// (app/(coach)/coach/members/[memberId]/page.tsx) 404s for a member
// the coach does not own, but a page guard is not an authorisation
// boundary: the Server Action is directly callable with any member id.
//
// This file exercises the DIRECT ACTION BOUNDARY — the Server Action
// itself, with a real session — not the service signature. Fixture
// setup/cleanup runs through the privileged fixture pool
// (tests/db/privileged-fixture.ts); every assertion runs through the
// application's own request path (app_login, RLS on).
//
// Agent-owned file.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { asTenantId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";
import { privilegedFixturePool } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

// Only the framework edges are stubbed: better-auth's session lookup
// and Next's header accessor. requireDefaultCtx() then resolves the
// session user to the platform users.id, the membership and the role —
// the same path a real request takes.
const session = vi.hoisted(() => ({ betterAuthId: "" }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: session.betterAuthId },
        session: { createdAt: new Date() },
      }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const { listMemberAlertsAction } = await import("@/lib/actions/absence-alerts");

const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const otherTenantId = asTenantId(uuidv7());

const locA = uuidv7();
const locB = uuidv7();
const programId = uuidv7();
const batchA = uuidv7();
const batchB = uuidv7();
const batchC = uuidv7();

const ownerPerson = uuidv7();
const coachAPerson = uuidv7();
const coachBPerson = uuidv7();
const coachCPerson = uuidv7();
const receptionPerson = uuidv7();
const childAPerson = uuidv7();
const childBPerson = uuidv7();
const foreignPerson = uuidv7();
const foreignLocationId = uuidv7();

const memberA = uuidv7();
const memberB = uuidv7();
const memberForeign = uuidv7();

const ownerUserId = uuidv7();
const ownerAuthId = `e-alerts-owner-${RUN}`;
const coachAUserId = uuidv7();
const coachAAuthId = `e-alerts-coach-a-${RUN}`;
const coachBUserId = uuidv7();
const coachBAuthId = `e-alerts-coach-b-${RUN}`;
const coachCUserId = uuidv7();
const coachCAuthId = `e-alerts-coach-c-${RUN}`;
const receptionUserId = uuidv7();
const receptionAuthId = `e-alerts-reception-${RUN}`;

const ownerStaffId = uuidv7();
const coachAStaffId = uuidv7();
const coachBStaffId = uuidv7();
const coachCStaffId = uuidv7();

const ownerMembershipId = uuidv7();
const coachAMembershipId = uuidv7();
const coachBMembershipId = uuidv7();
const coachCMembershipId = uuidv7();
const receptionMembershipId = uuidv7();

const alertIdA = uuidv7();
const alertIdB = uuidv7();

async function roleId(key: string, tenant = tenantId): Promise<string> {
  const rows = await privilegedFixturePool.query<{ id: string }>(
    "select id from roles where tenant_id = $1::uuid and key = $2",
    [tenant, key],
  );
  return rows.rows[0]!.id;
}

async function insertUser(id: string, authId: string): Promise<void> {
  // The tail of a uuidv7 is random; the head is the timestamp and
  // would collide for users created in the same millisecond.
  await privilegedFixturePool.query(
    "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
    [id, `+91${id.replace(/-/g, "").slice(-10)}`, authId],
  );
}

async function insertStaff(
  id: string,
  personId: string,
  userId: string,
  staffType: string,
): Promise<void> {
  await privilegedFixturePool.query(
    "insert into staff (id, tenant_id, person_id, user_id, staff_type) values ($1, $2, $3, $4, $5)",
    [id, tenantId, personId, userId, staffType],
  );
}

/** Turn the tenant-wide site scoping on/off (owner_read key: ops-only, so it is written as fixture setup). */
async function setLocationScoping(enabled: boolean): Promise<void> {
  await privilegedFixturePool.query(
    `insert into config_values (key, scope_type, scope_id, tenant_id, value, set_at)
     values ('access.location_scoped_staff', 'tenant', $1::text, $1::uuid, $2::jsonb, now())
     on conflict (key, scope_type, coalesce(scope_id, ''), coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))
       where superseded_at is null
     do update set value = excluded.value, set_at = excluded.set_at`,
    [tenantId, JSON.stringify(enabled)],
  );
}

beforeAll(async () => {
  await privilegedFixturePool.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'E Alerts Access', 'active', 'Asia/Kolkata')",
    [tenantId, `e-alerts-${RUN}`],
  );
  await privilegedFixturePool.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'E Alerts Other', 'active', 'Asia/Kolkata')",
    [otherTenantId, `e-alerts-other-${RUN}`],
  );
  await seedRoleTemplates(tenantId);
  await seedRoleTemplates(otherTenantId);
  for (const id of [locA, locB]) {
    await privilegedFixturePool.query(
      "insert into locations (id, tenant_id, name) values ($1, $2, $3)",
      [id, tenantId, id === locA ? "Site A" : "Site B"],
    );
  }

  await privilegedFixturePool.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Owner Person'), ($3, $2, 'Coach A'), ($4, $2, 'Coach B'), ($5, $2, 'Coach C'), ($6, $2, 'Reception'), ($7, $2, 'Child A'), ($8, $2, 'Child B')",
    [ownerPerson, tenantId, coachAPerson, coachBPerson, coachCPerson, receptionPerson, childAPerson, childBPerson],
  );
  await insertUser(ownerUserId, ownerAuthId);
  await insertUser(coachAUserId, coachAAuthId);
  await insertUser(coachBUserId, coachBAuthId);
  await insertUser(coachCUserId, coachCAuthId);
  await insertUser(receptionUserId, receptionAuthId);

  await insertStaff(ownerStaffId, ownerPerson, ownerUserId, "receptionist");
  await insertStaff(coachAStaffId, coachAPerson, coachAUserId, "coach");
  await insertStaff(coachBStaffId, coachBPerson, coachBUserId, "coach");
  await insertStaff(coachCStaffId, coachCPerson, coachCUserId, "coach");

  const ownerRole = await roleId("owner");
  const coachRole = await roleId("coach");
  const receptionRole = await roleId("receptionist");
  const memberships: Array<[string, string, string, boolean]> = [
    [ownerMembershipId, ownerUserId, ownerRole, true],
    [coachAMembershipId, coachAUserId, coachRole, true],
    [coachBMembershipId, coachBUserId, coachRole, true],
    // Coach C is granted site A only. Coach C coaches batch C (site
    // B) and child B is enrolled in it, so the ASSIGNMENT check
    // passes for child B — the only remaining dimension is the site
    // grant.
    [coachCMembershipId, coachCUserId, coachRole, false],
    [receptionMembershipId, receptionUserId, receptionRole, true],
  ];
  for (const [membershipId, userId, role, allLocations] of memberships) {
    await privilegedFixturePool.query(
      "insert into tenant_memberships (id, tenant_id, user_id, role_id, status, all_locations) values ($1, $2, $3, $4, 'active', $5)",
      [membershipId, tenantId, userId, role, allLocations],
    );
  }
  await privilegedFixturePool.query(
    "insert into membership_locations (id, tenant_id, membership_id, location_id) values ($1, $2, $3, $4)",
    [uuidv7(), tenantId, coachCMembershipId, locA],
  );

  await privilegedFixturePool.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Squash')",
    [programId, tenantId],
  );
  await privilegedFixturePool.query(
    "insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id, coach_id) values ($1, $2, $3, 'Batch A', 20, '{0,1,2,3,4,5,6}', '07:00', '08:00', $4, $5), ($6, $2, $3, 'Batch B', 20, '{0,1,2,3,4,5,6}', '07:00', '08:00', $7, $8), ($9, $2, $3, 'Batch C', 20, '{0,1,2,3,4,5,6}', '07:00', '08:00', $10, $11)",
    [batchA, tenantId, programId, locA, coachAStaffId, batchB, locB, coachBStaffId, batchC, locB, coachCStaffId],
  );
  await privilegedFixturePool.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, 'E-A', 'active'), ($5, $2, $6, $7, 'E-B', 'active')",
    [memberA, tenantId, childAPerson, locA, memberB, childBPerson, locB],
  );
  await privilegedFixturePool.query(
    "insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on) values ($1, $2, $3, $4, current_date - 30), ($5, $2, $6, $7, current_date - 30), ($8, $2, $6, $9, current_date - 30)",
    [uuidv7(), tenantId, memberA, batchA, uuidv7(), memberB, batchB, uuidv7(), batchC],
  );

  await privilegedFixturePool.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Foreign Child')",
    [foreignPerson, otherTenantId],
  );
  await privilegedFixturePool.query(
    "insert into locations (id, tenant_id, name) values ($1, $2, 'Foreign Site')",
    [foreignLocationId, otherTenantId],
  );
  await privilegedFixturePool.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, 'E-FOREIGN', 'active')",
    [memberForeign, otherTenantId, foreignPerson, foreignLocationId],
  );

  await privilegedFixturePool.query(
    "insert into absence_alerts (id, tenant_id, member_id, batch_id, alert_kind, calendar_week, detail) values ($1, $2, $3, $4, 'consecutive_absences', '2026-W40', '{\"streak\":3}'::jsonb), ($5, $2, $6, $7, 'low_monthly_attendance', '2026-W40', '{\"pct\":20}'::jsonb)",
    [alertIdA, tenantId, memberA, batchA, alertIdB, memberB, batchC],
  );
});

afterAll(async () => {
  const tenants = [tenantId, otherTenantId];
  await deleteAuditRowsForTenant(privilegedFixturePool, tenantId);
  await deleteAuditRowsForTenant(privilegedFixturePool, otherTenantId);
  for (const table of [
    "absence_alerts",
    "enrolments",
    "attendance",
    "sessions",
    "members",
    "batches",
    "programs",
    "membership_locations",
    "tenant_memberships",
    "role_permissions",
    "staff",
    "persons",
    "locations",
    "roles",
  ]) {
    await privilegedFixturePool.query(
      `delete from ${table} where tenant_id = any($1::uuid[])`,
      [tenants],
    );
  }
  await privilegedFixturePool.query(
    "delete from config_values where tenant_id = any($1::uuid[])",
    [tenants],
  );
  await privilegedFixturePool.query(
    "delete from tenant_features where tenant_id = any($1::uuid[])",
    [tenants],
  );
  await privilegedFixturePool.query(
    "delete from tenants where id = any($1::uuid[])",
    [tenants],
  );
  await privilegedFixturePool.query(
    "delete from users where id = any($1::uuid[])",
    [[ownerUserId, coachAUserId, coachBUserId, coachCUserId, receptionUserId]],
  );
  await privilegedFixturePool.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("F1 — the absence-alert list is scoped to the caller's resources", () => {
  it("an owner reads the alerts of a member in their own tenant", async () => {
    session.betterAuthId = ownerAuthId;
    const rows = await listMemberAlertsAction(memberA);
    expect(rows.map((r) => r.alertId)).toContain(alertIdA);
  });

  it("the assigned coach reads the alerts of their own member", async () => {
    session.betterAuthId = coachAAuthId;
    const rows = await listMemberAlertsAction(memberA);
    expect(rows.map((r) => r.alertId)).toContain(alertIdA);
  });

  it("an UNASSIGNED coach gets nothing for another coach's member", async () => {
    // Coach B coaches batch B; child A belongs to batch A. The
    // permission coach B holds is 'members.read.assigned' — "view
    // only members assigned to the coach's own batches" — so this
    // read must be empty, not another coach's alerts.
    session.betterAuthId = coachBAuthId;
    const rows = await listMemberAlertsAction(memberA);
    expect(rows).toEqual([]);
  });

  it("a member from another tenant yields nothing", async () => {
    session.betterAuthId = ownerAuthId;
    const rows = await listMemberAlertsAction(memberForeign);
    expect(rows).toEqual([]);
  });

  it("the assigned coach sees their own member while site scoping is off", async () => {
    // The non-vacuity anchor for the site case below: coach C IS
    // assigned to child B, so the read succeeds unless the site grant
    // refuses it.
    session.betterAuthId = coachCAuthId;
    const rows = await listMemberAlertsAction(memberB);
    expect(rows.map((r) => r.alertId)).toContain(alertIdB);
  });

  it("the assigned coach gets nothing for a member outside their site once site scoping is on", async () => {
    // Location scoping is an access control inside one academy, not
    // tenant isolation (lib/services/location-access.ts). Coach C is
    // granted site A; child B lives at site B.
    await setLocationScoping(true);
    try {
      session.betterAuthId = coachCAuthId;
      const rows = await listMemberAlertsAction(memberB);
      expect(rows).toEqual([]);
    } finally {
      await setLocationScoping(false);
    }
  });

  it("a caller without the members.read.assigned grant is refused", async () => {
    // The receptionist role holds members.read but NOT
    // members.read.assigned (lib/services/roles.ts). The action must
    // refuse before it reads anything.
    session.betterAuthId = receptionAuthId;
    await expect(listMemberAlertsAction(memberA)).rejects.toThrow(/forbidden/);
  });

  it("a role whose grant was revoked is refused", async () => {
    // The revoked grant is applied to a role in a TENANT THAT EXISTS
    // ONLY FOR THIS CASE, so nothing any other test (or lane) depends
    // on is mutated: the main fixture's coach role keeps its grant and
    // keeps serving the cases above. A killed test process could at
    // worst leave this probe tenant's coach role without the grant,
    // and that tenant is deleted in afterAll.
    const probeTenantId = asTenantId(uuidv7());
    const probeUserId = uuidv7();
    const probeAuthId = `e-alerts-probe-${RUN}`;
    await privilegedFixturePool.query(
      "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'E Alerts Probe', 'active', 'Asia/Kolkata')",
      [probeTenantId, `e-alerts-probe-${RUN}`],
    );
    await seedRoleTemplates(probeTenantId);
    const probeCoachRole = await roleId("coach", probeTenantId);
    await privilegedFixturePool.query(
      "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
      [probeUserId, `+9193${probeUserId.replace(/-/g, "").slice(-10)}`, probeAuthId],
    );
    await privilegedFixturePool.query(
      "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1, $2, $3, $4, 'active')",
      [uuidv7(), probeTenantId, probeUserId, probeCoachRole],
    );

    try {
      // The grant the role template would have given is removed from
      // the resolved set: the action must refuse, and the template
      // must not silently restore it.
      await privilegedFixturePool.query(
        "delete from role_permissions where tenant_id = $1::uuid and role_id = $2::uuid and permission_key = 'members.read.assigned'",
        [probeTenantId, probeCoachRole],
      );
      session.betterAuthId = probeAuthId;
      await expect(listMemberAlertsAction(memberA)).rejects.toThrow(/forbidden/);
    } finally {
      await privilegedFixturePool.query(
        "delete from tenant_memberships where tenant_id = $1::uuid",
        [probeTenantId],
      );
      await privilegedFixturePool.query(
        "delete from role_permissions where tenant_id = $1::uuid",
        [probeTenantId],
      );
      await privilegedFixturePool.query(
        "delete from roles where tenant_id = $1::uuid",
        [probeTenantId],
      );
      await privilegedFixturePool.query(
        "delete from tenants where id = $1::uuid",
        [probeTenantId],
      );
      await privilegedFixturePool.query(
        "delete from users where id = $1::uuid",
        [probeUserId],
      );
    }
  });

  it("the feature layer cannot deny this read: the members module is always on", async () => {
    // Recorded honestly rather than asserted as a denial: the members
    // module is in ALWAYS_ON_MODULES (lib/auth/permission.ts), so
    // requirePermission's entitlement check cannot refuse a members.*
    // grant for any tenant. The enforceable denial dimensions for this
    // read are tenant, site, grant and coach assignment — the four
    // asserted above.
    await privilegedFixturePool.query(
      "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, 'members', false) on conflict (tenant_id, feature_key) do update set enabled = false",
      [tenantId],
    );
    try {
      session.betterAuthId = ownerAuthId;
      const rows = await listMemberAlertsAction(memberA);
      expect(rows.map((r) => r.alertId)).toContain(alertIdA);
    } finally {
      await privilegedFixturePool.query(
        "delete from tenant_features where tenant_id = $1::uuid and feature_key = 'members'",
        [tenantId],
      );
    }
  });
});
