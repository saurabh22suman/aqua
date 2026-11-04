// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import type { IsolatedDb } from "@/tests/helpers/isolated-db";
import { asTenantId, asUserId } from "@/lib/ids";

let db: IsolatedDb;
let service: typeof import("@/lib/services/owner-people-reports");
const tenant = randomUUID();
const location = randomUUID();
const locationB = randomUUID();
const otherTenant = randomUUID();
const range = { from: "2026-10-01", to: "2026-10-31" };
const ctx: Ctx = { tenantId: asTenantId(tenant), userId: asUserId(randomUUID()), membershipId: randomUUID(), roleKey: "owner", roleId: randomUUID(), slug: "report-test", permissions: new Set(["reports.operational", "staff.attendance"]), features: new Set(["reports", "staff"]), allLocations: true, locationIds: [] };

beforeAll(async () => {
  vi.resetModules();
  const { startIsolatedDb } = await import("@/tests/helpers/isolated-db");
  db = await startIsolatedDb();
  process.env.DATABASE_URL = db.appUri;
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  vi.resetModules();
  service = await import("@/lib/services/owner-people-reports");
  await db.admin.query("insert into tenants (id, slug, name, status) values ($1,$2,'Report test','active')", [tenant, `report-${tenant}`]);
  await db.admin.query("insert into locations (id, tenant_id, name, is_primary) values ($1,$2,'Main',true)", [location, tenant]);
  await db.admin.query("insert into locations (id, tenant_id, name, is_primary) values ($1,$2,'Other',false)", [locationB, tenant]);
  await db.admin.query("insert into tenants (id, slug, name, status) values ($1,$2,'Other tenant','active')", [otherTenant, `report-${otherTenant}`]);
  await db.admin.query("insert into config_keys (key,value_schema,default_value,visibility,risk,description) values ('access.location_scoped_staff','{}','false','owner_read','safe','test') on conflict do nothing");
  await db.admin.query("insert into config_values (id,key,scope_type,scope_id,tenant_id,value) values ($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')", [randomUUID(), tenant]);
  for (const [status, joined] of [["active", "2026-10-10"], ["paused", "2025-01-01"], ["trial", null]] as const) {
    const person = randomUUID();
    await db.admin.query("insert into persons (id,tenant_id,full_name) values ($1,$2,'Test person')", [person, tenant]);
    await db.admin.query("insert into members (id,tenant_id,person_id,location_id,member_code,status,joined_on) values ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), tenant, person, location, randomUUID(), status, joined]);
  }
  const otherPerson = randomUUID();
  await db.admin.query("insert into persons (id,tenant_id,full_name) values ($1,$2,'Other site')", [otherPerson, tenant]);
  await db.admin.query("insert into members (id,tenant_id,person_id,location_id,member_code,status,joined_on) values ($1,$2,$3,$4,$5,'active','2026-10-11')", [randomUUID(), tenant, otherPerson, locationB, randomUUID()]);
  const foreignLocation = randomUUID(), foreignPerson = randomUUID(), foreignStaff = randomUUID();
  await db.admin.query("insert into locations (id,tenant_id,name,is_primary) values ($1,$2,'Foreign',true)", [foreignLocation, otherTenant]);
  await db.admin.query("insert into persons (id,tenant_id,full_name) values ($1,$2,'Foreign')", [foreignPerson, otherTenant]);
  await db.admin.query("insert into members (id,tenant_id,person_id,location_id,member_code,status,joined_on) values ($1,$2,$3,$4,$5,'active','2026-10-10')", [randomUUID(), otherTenant, foreignPerson, foreignLocation, randomUUID()]);
  await db.admin.query("insert into staff (id,tenant_id,person_id,staff_type) values ($1,$2,$3,'coach')", [foreignStaff, otherTenant, foreignPerson]);
  await db.admin.query("insert into staff_attendance (id,tenant_id,staff_id,work_date,method,status,client_id) values ($1,$2,$3,'2026-10-10','self_app','absent',$4)", [randomUUID(), otherTenant, foreignStaff, randomUUID()]);
  for (const site of [location, locationB, null]) {
    const person = randomUUID(), staffId = randomUUID(), shiftId = site ? randomUUID() : null;
    await db.admin.query("insert into persons (id,tenant_id,full_name) values ($1,$2,'Staff')", [person, tenant]);
    await db.admin.query("insert into staff (id,tenant_id,person_id,staff_type) values ($1,$2,$3,'coach')", [staffId, tenant, person]);
    if (site) await db.admin.query("insert into shifts (id,tenant_id,staff_id,location_id,shift_date,start_at,end_at,status) values ($1,$2,$3,$4,'2026-10-10','2026-10-10 04:00Z','2026-10-10 05:00Z','rostered')", [shiftId, tenant, staffId, site]);
    await db.admin.query("insert into staff_attendance (id,tenant_id,staff_id,shift_id,work_date,checked_in_at,method,status,client_id) values ($1,$2,$3,$4,'2026-10-10','2026-10-10 04:05Z','self_app','present',$5)", [randomUUID(), tenant, staffId, shiftId, randomUUID()]);
  }
}, 180_000);

afterAll(async () => {
  if (db) {
    const { pool } = await import("@/db/client");
    await pool.end();
    await db.stop();
  }
});

it("reports only attendance attached to the selected shift location, separately from shifts", async () => {
  const report = await service.getStaffReport(ctx, { ...range, locationId: location });
  expect(report.attendance).toEqual([{ date: "2026-10-10", status: "present", locationId: location, checkedIn: true }]);
  expect(report.shifts).toEqual([{ date: "2026-10-10", status: "rostered", locationId: location }]);
});

it("distinguishes a recorded check-in from a status alone", async () => {
  const report = await service.getStaffReport(ctx, { ...range, locationId: location });
  expect(report.attendance[0]).toHaveProperty("checkedIn", true);
});

it("separates the present status snapshot from range joins and unknown join dates", async () => {
  const report = await service.getMembersReport(ctx, range);
  expect(report.statuses).toEqual(expect.arrayContaining([{ status: "active", count: 2 }, { status: "paused", count: 1 }, { status: "trial", count: 1 }]));
  expect(report.joined).toBe(2);
  expect(report.joinedUnknown).toBe(1);
  expect(report.joinedByDay).toEqual([{ date: "2026-10-10", count: 1 }, { date: "2026-10-11", count: 1 }]);
});

it("intersects restricted access and explicit facility without exposing unassigned or other tenants", async () => {
  const scoped = { ...ctx, allLocations: false, locationIds: [location] };
  const report = await service.getStaffReport(scoped, range);
  expect(report.attendance).toEqual([{ date: "2026-10-10", status: "present", locationId: location, checkedIn: true }]);
  expect(report.shifts).toHaveLength(1);
  expect((await service.getMembersReport(scoped, range)).joined).toBe(1);
  expect(await service.getStaffReport(scoped, { ...range, locationId: locationB })).toEqual({ attendance: [], shifts: [] });
  expect((await service.getMembersReport(scoped, { ...range, locationId: locationB })).statuses).toEqual([]);
  const empty = { ...ctx, allLocations: false, locationIds: [] };
  expect(await service.getStaffReport(empty, range)).toEqual({ attendance: [], shifts: [] });
  expect((await service.getMembersReport(empty, range)).statuses).toEqual([]);
  const all = await service.getStaffReport(ctx, range);
  expect(all.attendance).toHaveLength(3);
  expect(all.attendance.filter((row) => row.locationId === null)).toHaveLength(1);
});

it("rejects missing operational or staff attendance grants", async () => {
  await expect(service.getMembersReport({ ...ctx, permissions: new Set() }, range)).rejects.toThrow(/reports.operational/);
  await expect(service.getStaffReport({ ...ctx, permissions: new Set(["reports.operational"]) }, range)).rejects.toThrow(/staff.attendance/);
  await expect(service.getStaffReport({ ...ctx, permissions: new Set(["staff.attendance"]) }, range)).rejects.toThrow(/reports.operational/);
});

it("matches active additional facilities without duplication or widening primary-location access", async () => {
  const rows = await db.admin.query<{ id: string; location_id: string; status: string }>(
    "select id, location_id, status from members where tenant_id = $1", [tenant],
  );
  const activeA = rows.rows.find((row) => row.location_id === location && row.status === "active")!;
  const trialA = rows.rows.find((row) => row.location_id === location && row.status === "trial")!;
  const activeB = rows.rows.find((row) => row.location_id === locationB)!;
  for (const [member, ended] of [[activeA.id, null], [trialA.id, "2026-10-15"], [activeB.id, null]] as const) {
    await db.admin.query("insert into member_facility_optins (id,tenant_id,member_id,location_id,opted_on,ended_on) values ($1,$2,$3,$4,'2026-01-01',$5)", [randomUUID(), tenant, member, locationB, ended]);
  }
  const selected = await service.getMembersReport(ctx, { ...range, locationId: locationB });
  expect(selected.statuses).toEqual([{ status: "active", count: 2 }]);
  expect(selected.joined).toBe(2);
  expect(selected.joinedByDay).toEqual([{ date: "2026-10-10", count: 1 }, { date: "2026-10-11", count: 1 }]);
  expect(selected.joinedUnknown).toBe(0);
  const onlyB = { ...ctx, allLocations: false, locationIds: [locationB] };
  expect((await service.getMembersReport(onlyB, { ...range, locationId: locationB })).statuses).toEqual([{ status: "active", count: 1 }]);
  const noAccess = { ...ctx, allLocations: false, locationIds: [] };
  expect((await service.getMembersReport(noAccess, { ...range, locationId: locationB })).statuses).toEqual([]);
});
