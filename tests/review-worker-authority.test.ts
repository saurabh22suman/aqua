// @vitest-environment node
//
// A05 — Human Worker authority regression (docs/audits/2026-10-09-role-content-permission-audit.md).
//
// The seeded Worker role template must be self-service only: `staff.self`
// for the caller's own roster / check-in / leave. It must never carry
// `staff.roster`, which lib/actions/shifts.ts and lib/actions/leave.ts use
// to build, delete and publish the roster and to approve someone else's
// leave. Existing system Worker roles need a forward-only corrective
// migration; custom roles must not be touched.
//
// Harness: real Postgres 16 container, bootstrapRoles -> runMigrations ->
// seedPlatformCatalogue, synthetic tenant data (same pattern as
// tests/review-resource-integrity.test.ts). The action layer is invoked
// directly with a Worker context whose permission set is read from
// role_permissions, so removing the grant turns each `refusalOf`
// expectation green.
//
// First run is deliberately red: lib/services/roles.ts still seeds
// `staff.roster` for Worker.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  asStaffId,
  asTenantId,
  asUserId,
  type StaffId,
  type TenantId,
  type UserId,
} from "@/lib/ids";

const mocks = vi.hoisted(() => ({ ctx: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: mocks.ctx,
  NotFoundError: class extends Error {},
}));

const MIGRATIONS_DIR = resolve(process.cwd(), "db", "migrations");
const workerMigrationFile = (() => {
  if (!existsSync(MIGRATIONS_DIR)) return undefined;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(
      (f) =>
        f.endsWith(".sql") && /worker/i.test(f) && !/heartbeat/i.test(f),
    )
    .sort();
  return files.length > 0 ? files[files.length - 1] : undefined;
})();

type TestCtx = {
  tenantId: TenantId;
  userId: UserId;
  roleKey: string;
  allLocations: boolean;
  locationIds: string[];
  permissions: Set<string>;
  features: Set<string>;
  requestId: string;
};

let container: StartedPostgreSqlContainer;
let admin: Pool;
let tenantId: TenantId;
let workerUserId: UserId;
let workerStaffId: StaffId;
let targetStaffId: StaffId;
let locationId: string;
let leaveTypeId: string;
let workerCtx: TestCtx;

let shiftsActions: typeof import("@/lib/actions/shifts");
let leaveActions: typeof import("@/lib/actions/leave");
let staffAttendanceActions: typeof import("@/lib/actions/staff-attendance");
let rolesService: typeof import("@/lib/services/roles");

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = `postgresql://app_login:review-tests@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = "review-tests";
  process.env.BETTER_AUTH_SECRET = "review-tests-secret";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PARENT_LINK_SECRET = "review-tests-secret";

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(url, "review-tests");
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(url);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(url);
  admin = new Pool({ connectionString: url });

  tenantId = asTenantId(randomUUID());
  workerUserId = asUserId(randomUUID());
  const ownerUserId = asUserId(randomUUID());
  const targetUserId = asUserId(randomUUID());
  workerStaffId = asStaffId(randomUUID());
  targetStaffId = asStaffId(randomUUID());
  locationId = randomUUID();

  await admin.query(
    "insert into tenants(id,slug,name,status) values($1,$2,'Worker authority','active')",
    [tenantId, `worker-authority-${tenantId}`],
  );
  await admin.query(
    "insert into users(id,phone) values($1,'+919900001001'),($2,'+919900001002'),($3,'+919900001003')",
    [workerUserId, ownerUserId, targetUserId],
  );

  rolesService = await import("@/lib/services/roles");
  await rolesService.seedRoleTemplates(tenantId);

  const roleId = async (key: string): Promise<string> => {
    const { rows } = await admin.query<{ id: string }>(
      "select id from roles where tenant_id=$1 and key=$2",
      [tenantId, key],
    );
    if (!rows[0]) throw new Error(`missing seeded role ${key}`);
    return rows[0].id;
  };

  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Main',true)",
    [locationId, tenantId],
  );
  const workerPerson = randomUUID();
  const targetPerson = randomUUID();
  await admin.query(
    "insert into persons(id,tenant_id,full_name) values($1,$2,'Worker Synthetic'),($3,$2,'Target Coach Synthetic')",
    [workerPerson, tenantId, targetPerson],
  );
  await admin.query(
    "insert into staff(id,tenant_id,person_id,user_id,staff_type) values($1,$2,$3,$4,'worker'),($5,$2,$6,$7,'coach')",
    [
      workerStaffId,
      tenantId,
      workerPerson,
      workerUserId,
      targetStaffId,
      targetPerson,
      targetUserId,
    ],
  );
  await admin.query(
    "insert into tenant_memberships(id,tenant_id,user_id,role_id,status) values($1,$2,$3,$4,'active'),($5,$2,$6,$7,'active'),($8,$2,$9,$10,'active')",
    [
      randomUUID(),
      tenantId,
      workerUserId,
      await roleId("worker"),
      randomUUID(),
      ownerUserId,
      await roleId("owner"),
      randomUUID(),
      targetUserId,
      await roleId("coach"),
    ],
  );

  workerCtx = await ctxFor(tenantId, workerUserId, "worker");
  mocks.ctx.mockResolvedValue(workerCtx);

  shiftsActions = await import("@/lib/actions/shifts");
  leaveActions = await import("@/lib/actions/leave");
  staffAttendanceActions = await import("@/lib/actions/staff-attendance");

  const { rows } = await admin.query<{ id: string }>(
    "insert into leave_types(id,tenant_id,name,annual_quota,is_paid) values($1,$2,'Casual',12,true) returning id",
    [randomUUID(), tenantId],
  );
  leaveTypeId = rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end().catch(() => {});
  await admin?.end();
  await container?.stop();
});

async function ctxFor(
  tid: TenantId,
  userId: UserId,
  roleKey: string,
): Promise<TestCtx> {
  const { rows } = await admin.query<{ permission_key: string }>(
    `select rp.permission_key
       from role_permissions rp
       join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
      where r.tenant_id = $1 and r.key = $2`,
    [tid, roleKey],
  );
  return {
    tenantId: tid,
    userId,
    roleKey,
    allLocations: true,
    locationIds: [],
    permissions: new Set(rows.map((r) => r.permission_key)),
    features: new Set(["staff"]),
    requestId: randomUUID(),
  };
}

async function permissionKeys(
  roleKey: string,
  tid: TenantId = tenantId,
): Promise<string[]> {
  const { rows } = await admin.query<{ permission_key: string }>(
    `select rp.permission_key
       from role_permissions rp
       join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
      where r.tenant_id = $1 and r.key = $2
      order by rp.permission_key`,
    [tid, roleKey],
  );
  return rows.map((r) => r.permission_key);
}

async function insertShift(
  staffId: StaffId,
  shiftDate: string,
  startAt: string,
  endAt: string,
  published: boolean,
): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into shifts(id,tenant_id,staff_id,location_id,shift_date,start_at,end_at,status,published_at)
     values($1,$2,$3,$4,$5,$6,$7,'rostered',$8)`,
    [
      id,
      tenantId,
      staffId,
      locationId,
      shiftDate,
      startAt,
      endAt,
      published ? new Date(startAt) : null,
    ],
  );
  return id;
}

// The remediation can refuse by throwing (requirePermission's
// ForbiddenError) or by returning a failure result; either is a refusal.
// A success result or an unrelated error fails loudly.
async function refusalOf(run: () => Promise<unknown>): Promise<void> {
  let outcome: unknown;
  try {
    outcome = await run();
  } catch (error) {
    expect(String((error as Error).message)).toMatch(
      /forbidden|not allowed|permission|unauthorized|not authorized/i,
    );
    return;
  }
  expect(outcome).toMatchObject({ ok: false });
}

async function seedSimulatedPreFixTenant(): Promise<{
  main: TenantId;
  customHome: TenantId;
  customKey: TenantId;
}> {
  const mkTenant = async (label: string): Promise<TenantId> => {
    const tid = asTenantId(randomUUID());
    await admin.query(
      "insert into tenants(id,slug,name,status) values($1,$2,$3,'active')",
      [tid, `worker-migration-${tid}`, label],
    );
    return tid;
  };
  const main = await mkTenant("Worker migration sim");
  const customHome = await mkTenant("Worker migration custom home");
  const customKey = await mkTenant("Worker migration custom key");

  const roles: ReadonlyArray<readonly [string, string, boolean]> = [
    ["worker", "Worker", true],
    ["owner", "Owner", true],
    ["admin", "Administrator", true],
    ["crew-lead", "Crew lead", false],
  ];
  for (const [key, name, isSystem] of roles) {
    await admin.query(
      "insert into roles(id,tenant_id,key,name,is_system) values($1,$2,$3,$4,$5)",
      [randomUUID(), main, key, name, isSystem],
    );
  }
  // A tenant that customised the system Worker's home route: the
  // corrective migration must still strip staff.roster but leave /floor.
  await admin.query(
    "insert into roles(id,tenant_id,key,name,is_system,home_path,home_ordinal) values($1,$2,'worker','Worker',true,'/floor',3)",
    [randomUUID(), customHome],
  );
  // A NON-system role that happens to use key='worker': the migration
  // must not touch it at all — neither the grant nor the home path.
  await admin.query(
    "insert into roles(id,tenant_id,key,name,is_system) values($1,$2,'worker','Custom worker',false)",
    [randomUUID(), customKey],
  );
  // Pre-fix state: Worker carries staff.roster; custom roles carry it too.
  await admin.query(
    `insert into role_permissions(tenant_id,role_id,permission_key)
     select $1, r.id, p.permission_key
       from roles r
       join (values
         ('worker','staff.roster'),
         ('worker','staff.self'),
         ('owner','staff.roster'),
         ('admin','staff.roster'),
         ('crew-lead','staff.roster')
       ) as p(role_key, permission_key) on p.role_key = r.key
      where r.tenant_id = $1`,
    [main],
  );
  await admin.query(
    `insert into role_permissions(tenant_id,role_id,permission_key)
     select $1, r.id, p.permission_key
       from roles r
       join (values ('worker','staff.roster'),('worker','staff.self'))
         as p(role_key, permission_key) on p.role_key = r.key
      where r.tenant_id = $1`,
    [customHome],
  );
  await admin.query(
    `insert into role_permissions(tenant_id,role_id,permission_key)
     select $1, r.id, p.permission_key
       from roles r
       join (values ('worker','staff.roster'),('worker','staff.self'))
         as p(role_key, permission_key) on p.role_key = r.key
      where r.tenant_id = $1`,
    [customKey],
  );
  return { main, customHome, customKey };
}

async function homePath(
  roleKey: string,
  tid: TenantId = tenantId,
): Promise<string | null> {
  const { rows } = await admin.query<{ home_path: string }>(
    "select home_path from roles where tenant_id=$1 and key=$2",
    [tid, roleKey],
  );
  return rows[0]?.home_path ?? null;
}

describe("A05 human Worker authority", () => {
  it("seeds the Worker template with staff.self and without staff.roster", async () => {
    const worker = await permissionKeys("worker");
    expect(worker).not.toContain("staff.roster");
    expect(worker).toContain("staff.self");
    expect(await permissionKeys("owner")).toContain("staff.roster");
    expect(await permissionKeys("admin")).toContain("staff.roster");
    expect(await permissionKeys("receptionist")).not.toContain("staff.roster");
  });

  it("refuses Worker shift creation for another staff member without writing a row", async () => {
    await refusalOf(() =>
      shiftsActions.createShiftAction({
        staffId: targetStaffId,
        locationId,
        shiftDate: "2026-11-02",
        startTime: "09:00",
        endTime: "10:00",
      }),
    );
    const { rows } = await admin.query(
      "select id from shifts where tenant_id=$1 and staff_id=$2",
      [tenantId, targetStaffId],
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses Worker shift deletion and roster publish", async () => {
    const deletable = await insertShift(
      targetStaffId,
      "2026-12-01",
      "2026-12-01T03:30:00Z",
      "2026-12-01T04:30:00Z",
      true,
    );
    await refusalOf(() => shiftsActions.deleteShiftAction(deletable));
    expect(
      (await admin.query("select id from shifts where id=$1", [deletable]))
        .rows,
    ).toHaveLength(1);

    const unpublished = await insertShift(
      targetStaffId,
      "2026-11-10",
      "2026-11-10T03:30:00Z",
      "2026-11-10T04:30:00Z",
      false,
    );
    await refusalOf(() =>
      shiftsActions.publishRosterAction({ weekStart: "2026-11-09" }),
    );
    const { rows } = await admin.query<{ published_at: Date | null }>(
      "select published_at from shifts where id=$1",
      [unpublished],
    );
    expect(rows[0]!.published_at).toBeNull();
  });

  it("refuses Worker approval of another staff member's leave", async () => {
    const requestId = randomUUID();
    await admin.query(
      "insert into leave_requests(id,tenant_id,staff_id,leave_type_id,from_date,to_date,days,status) values($1,$2,$3,$4,'2026-12-10','2026-12-11',2,'pending')",
      [requestId, tenantId, targetStaffId, leaveTypeId],
    );
    await refusalOf(() =>
      leaveActions.approveLeaveRequestAction({ requestId, note: "Covered" }),
    );
    const { rows } = await admin.query<{ status: string }>(
      "select status from leave_requests where id=$1",
      [requestId],
    );
    expect(rows[0]!.status).toBe("pending");
  });

  it("keeps Worker self-service: own published shifts, own leave list, own check-in", async () => {
    const ownShift = await insertShift(
      workerStaffId,
      "2026-11-05",
      "2026-11-05T03:30:00Z",
      "2026-11-05T04:30:00Z",
      true,
    );
    const mine = await shiftsActions.listMyShiftsAction({
      fromDate: "2026-11-01",
      toDate: "2026-11-30",
    });
    expect(mine.map((s) => s.id)).toEqual([ownShift]);

    const ownRequest = randomUUID();
    await admin.query(
      "insert into leave_requests(id,tenant_id,staff_id,leave_type_id,from_date,to_date,days,status) values($1,$2,$3,$4,'2026-11-20','2026-11-20',1,'pending')",
      [ownRequest, tenantId, workerStaffId, leaveTypeId],
    );
    const leaveView = await leaveActions.listMyLeaveAction({ year: 2026 });
    expect(leaveView.requests.map((r) => r.id)).toContain(ownRequest);

    const checked = await staffAttendanceActions.selfCheckInAction({
      method: "self_app",
      clientId: randomUUID(),
    });
    expect(checked).toMatchObject({ ok: true });
  });

  it.skipIf(!workerMigrationFile)(
    "corrective migration strips staff.roster from system worker roles only and is idempotent",
    async () => {
      if (!workerMigrationFile) return;
      const sqlText = readFileSync(
        resolve(MIGRATIONS_DIR, workerMigrationFile),
        "utf8",
      );
      const sim = await seedSimulatedPreFixTenant();

      await admin.query(sqlText);
      expect(await permissionKeys("worker", sim.main)).toEqual(["staff.self"]);
      expect(await permissionKeys("owner", sim.main)).toEqual(["staff.roster"]);
      expect(await permissionKeys("admin", sim.main)).toEqual(["staff.roster"]);
      expect(await permissionKeys("crew-lead", sim.main)).toEqual([
        "staff.roster",
      ]);
      // The system Worker's placeholder /parent home is repointed.
      expect(await homePath("worker", sim.main)).toBe("/worker");

      // A tenant-customised home_path is preserved; the system role's
      // roster grant is still stripped.
      expect(await permissionKeys("worker", sim.customHome)).toEqual([
        "staff.self",
      ]);
      expect(await homePath("worker", sim.customHome)).toBe("/floor");

      // A non-system role with key='worker' is untouched entirely.
      expect(await permissionKeys("worker", sim.customKey)).toEqual([
        "staff.roster",
        "staff.self",
      ]);
      expect(await homePath("worker", sim.customKey)).toBe("/parent");

      await admin.query(sqlText);
      expect(await permissionKeys("worker", sim.main)).toEqual(["staff.self"]);
      expect(await homePath("worker", sim.main)).toBe("/worker");
      expect(await permissionKeys("worker", sim.customHome)).toEqual([
        "staff.self",
      ]);
      expect(await homePath("worker", sim.customHome)).toBe("/floor");
      expect(await permissionKeys("worker", sim.customKey)).toEqual([
        "staff.roster",
        "staff.self",
      ]);
      expect(await homePath("worker", sim.customKey)).toBe("/parent");
      expect(await permissionKeys("crew-lead", sim.main)).toEqual([
        "staff.roster",
      ]);
    },
  );
});
