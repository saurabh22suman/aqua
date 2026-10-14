import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";

// R02 direct-action gap: getMemberDetailAction must not answer any
// members.read holder with the full 360. The action's context is mocked
// so the direct action adapter can be called as an authenticated caller.
const mocks = vi.hoisted(() => ({ ctx: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: mocks.ctx,
  NotFoundError: class extends Error {},
}));

// C01/R02 (docs/audits/2026-10-09-role-content-permission-audit.md §9 C01,
// §10 R02) — the Accountant is a narrow financial actor. The Owner member
// 360 (getMemberDetail) must keep its full projection for Owner/Reception,
// but the Accountant gets a payer-only view: display name, code, phone,
// location and minor flag — no dateOfBirth, medical notes, guardians,
// consent evidence or address. This file is the RED for the planned
// getMemberPayerView export and ownerNavForPermissions/ownerSidebarGroups
// filtering; it is outside tests/tier1/** on purpose.
//
// RED command (before implementation):
//   AQUA_NO_DOTENV=1 NODE_ENV=test \
//   DATABASE_URL=postgresql://app_login:unused@127.0.0.1:1/aqua \
//   pnpm exec vitest run tests/review-accountant-projection.test.ts --maxWorkers=1
// GREEN rerun: same command.

let container: StartedPostgreSqlContainer;
let admin: Pool;
let people: typeof import("@/lib/services/people");
let nav: typeof import("@/lib/nav");

const tenantId = asTenantId(randomUUID());
const userId = asUserId(randomUUID());
const locationA = randomUUID();
const locationB = randomUUID();
const memberA = randomUUID();
const memberB = randomUUID();

// Mirrors the seeded accountant template (lib/services/roles.ts) — the
// caller's ctx in production always carries this resolved set.
const ACCOUNTANT_PERMISSIONS = [
  "invoices.read",
  "invoices.write",
  "payments.read",
  "payments.record",
  "payments.refund",
  "reports.financial",
  "reports.operational",
  "staff.pay.read",
  "staff.self",
  "members.read",
  "settings.read",
];

const accountant = {
  tenantId,
  userId,
  roleKey: "accountant",
  allLocations: true,
  locationIds: [],
  permissions: new Set(ACCOUNTANT_PERMISSIONS),
};
const scopedAccountant = {
  ...accountant,
  allLocations: false,
  locationIds: [locationA],
};
const owner = { tenantId, userId, roleKey: "owner", allLocations: true, locationIds: [] };
// The owner's production ctx always carries the resolved grant set; the
// direct action adapter reads it.
const ownerAction = {
  ...owner,
  permissions: new Set(["members.read", "members.write", "attendance.read"]),
};

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  process.env.DATABASE_URL = `postgresql://app_login:review-accountant@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = "review-accountant";
  const url = container.getConnectionUri();
  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(url, "review-accountant");
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(url);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(url);
  admin = new Pool({ connectionString: url });

  await admin.query(
    "insert into tenants(id,slug,name,status) values($1,$2,'Review accountant','active')",
    [tenantId, `review-accountant-${tenantId}`],
  );
  await admin.query("insert into users(id,phone) values($1,'+919000007001')", [userId]);
  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A',true),($2,$3,'B',false)",
    [locationA, locationB, tenantId],
  );
  const personA = randomUUID();
  const personB = randomUUID();
  const guardian = randomUUID();
  await admin.query(
    "insert into persons(id,tenant_id,full_name,date_of_birth,phone,medical_notes) values($1,$4,'Payer A','2015-01-01','+919000007002','Synthetic medical note'),($2,$4,'Payer B','1990-01-01',null,null),($3,$4,'Guardian A',null,'+919000007003',null)",
    [personA, personB, guardian, tenantId],
  );
  await admin.query(
    "insert into members(id,tenant_id,person_id,location_id,member_code,status) values($1,$3,$4,$6,'PAY-1','active'),($2,$3,$5,$7,'PAY-2','active')",
    [memberA, memberB, tenantId, personA, personB, locationA, locationB],
  );
  await admin.query(
    "insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship,is_primary) values($1,$2,$3,$4,'mother',true)",
    [randomUUID(), tenantId, personA, guardian],
  );
  await admin.query(
    "insert into consents(id,tenant_id,person_id,purpose,granted_by,policy_version,evidence) values($1,$2,$3,'processing',$4,'2026.1',$5)",
    [
      randomUUID(),
      tenantId,
      personA,
      guardian,
      JSON.stringify({ granterName: "Guardian A" }),
    ],
  );
  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );

  people = await import("@/lib/services/people");
  nav = await import("@/lib/nav");
}, 120_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end();
  await admin?.end();
  await container?.stop();
});

describe("R02 payer-only projection", () => {
  it("exposes the planned getMemberPayerView export", () => {
    expect(typeof people.getMemberPayerView).toBe("function");
  });

  it("returns payer identity fields and nothing from the medical/child record", async () => {
    const view = await people.getMemberPayerView(accountant, memberA);
    expect(view).not.toBeNull();
    expect(view).toMatchObject({
      memberId: memberA,
      fullName: "Payer A",
      phone: "+919000007002",
      memberCode: "PAY-1",
      status: "active",
      locationName: "A",
      isMinor: true,
    });
    for (const forbidden of [
      "dateOfBirth",
      "medicalNotes",
      "guardians",
      "consents",
      "address",
      "gender",
      "statusHistory",
    ]) {
      expect(Object.keys(view!), `payer view leaked ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("hides a member outside the accountant's scoped locations", async () => {
    expect(await people.getMemberPayerView(scopedAccountant, memberB)).toBeNull();
    expect(await people.getMemberPayerView(scopedAccountant, memberA)).not.toBeNull();
  });

  it("keeps the full member-360 for the owner (positive control)", async () => {
    const detail = await people.getMemberDetail(owner, memberA);
    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      dateOfBirth: "2015-01-01",
      medicalNotes: "Synthetic medical note",
    });
    expect(detail!.guardians.length).toBeGreaterThan(0);
    expect(detail!.consents.length).toBeGreaterThan(0);
  });
});

describe("C01 finance-shaped owner navigation", () => {
  it("hides owner entries the accountant cannot use", () => {
    const items = nav.ownerNavForPermissions(accountant.permissions);
    expect(items.map((i) => i.href)).toEqual([
      "/owner",
      "/owner/members",
      "/owner/reports",
    ]);
    const sidebarHrefs = nav
      .ownerSidebarGroupsForPermissions(accountant.permissions)
      .flatMap((group) => group.items.map((item) => item.href));
    expect(sidebarHrefs).toEqual([
      "/owner",
      "/owner/members",
      "/owner/fees",
      "/owner/reports",
    ]);
  });

  it("shows every entry to a caller holding all gates (owner/admin)", () => {
    const all = new Set([
      "dashboard.view",
      "members.read",
      "invoices.read",
      "enquiries.read",
      // C04 — the Announcements sidebar entry is gated on the
      // messaging.send grant the page's composer requires.
      "messaging.send",
      "programs.read",
      // R10 — Sessions (programs.write) and Schedule (attendance.read)
      // are first-class sidebar destinations now.
      "programs.write",
      "attendance.read",
      "staff.read",
      "reports.operational",
      "settings.manage",
    ]);
    expect(nav.ownerNavForPermissions(all)).toEqual(nav.TENANT_SURFACE_NAV.owner);
    const sidebarHrefs = nav
      .ownerSidebarGroupsForPermissions(all)
      .flatMap((group) => group.items.map((item) => item.href));
    expect(sidebarHrefs).toEqual(
      nav.OWNER_SIDEBAR_GROUPS.flatMap((group) => group.items.map((item) => item.href)),
    );
  });
});

describe("R02 direct getMemberDetailAction boundary", () => {
  it("returns null to an accountant holding members.read but neither attendance.read nor members.write", async () => {
    mocks.ctx.mockResolvedValue(accountant);
    const actions = await import("@/lib/actions/people");
    expect(await actions.getMemberDetailAction(memberA)).toBeNull();
  });

  it("keeps the full member-360 for an owner through the action (positive)", async () => {
    mocks.ctx.mockResolvedValue(ownerAction);
    const actions = await import("@/lib/actions/people");
    const detail = await actions.getMemberDetailAction(memberA);
    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      dateOfBirth: "2015-01-01",
      medicalNotes: "Synthetic medical note",
    });
    expect(detail!.guardians.length).toBeGreaterThan(0);
  });
});
