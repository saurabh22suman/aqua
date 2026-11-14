import { afterAll, beforeAll, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "@/tests/db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { createBooking, SLOT_TAKEN_ERROR } from "@/lib/services/bookings";

const tenantId = asTenantId(uuidv7()), userId = asUserId(uuidv7());
const roleId = uuidv7(), locationId = uuidv7(), facilityId = uuidv7(), laneId = uuidv7(), otherFacilityId = uuidv7();
beforeAll(async () => {
  await admin.query("insert into tenants(id,slug,name,status) values($1,$2,'Concurrency diagnostic','active')", [tenantId, `concurrency-${tenantId}`]);
  await admin.query("insert into users(id,phone) values($1,$2)", [userId, `+91${String(BigInt(`0x${userId.replaceAll('-', '').slice(-10)}`) % 10000000000n).padStart(10, '0')}`]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'owner','Owner','/owner',0)", [roleId, tenantId]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)", [uuidv7(), tenantId, userId, roleId]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Main',true)", [locationId, tenantId]);
  await admin.query("insert into facilities(id,tenant_id,location_id,name,kind,capacity) values($1,$2,$3,'Pool','pool',4)", [facilityId, tenantId, locationId]);
  await admin.query("insert into facilities(id,tenant_id,location_id,name,kind,capacity) values($1,$2,$3,'Other Pool','pool',4)", [otherFacilityId, tenantId, locationId]);
  await admin.query("insert into facility_sub_units(id,tenant_id,facility_id,name) values($1,$2,$3,'Lane')", [laneId, tenantId, facilityId]);
  await admin.query("insert into booking_price_rules(id,tenant_id,facility_id,label,days_of_week,price_paise,priority,is_active) values($1,$2,null,'Default','{}',50000,0,true)", [uuidv7(), tenantId]);
});
afterAll(async () => {
  for (const table of ["bookings", "booking_price_rules", "facility_sub_units", "facilities", "tenant_memberships", "roles", "locations"]) await admin.query(`delete from ${table} where tenant_id=$1`, [tenantId]);
  await admin.query("delete from tenants where id=$1", [tenantId]);
  // An immutable audit row may still refer to this actor; never delete that evidence.
  await admin.query("delete from users where id=$1 and not exists (select 1 from audit_log where actor_id=users.id)", [userId]);
  await admin.end();
});
function codes(error: unknown): string[] {
  const result: string[] = [];
  for (let value = error, i = 0; value && typeof value === "object" && i < 8; i++) {
    const item = value as { code?: unknown; cause?: unknown };
    if (typeof item.code === "string") result.push(item.code);
    value = item.cause;
  }
  return result;
}
it("reports underlying SQLSTATE if fifty simultaneous booking attempts reject", async () => {
  const rejected: string[][] = [];
  for (let round = 0; round < 6; round++) {
    const start = new Date(Date.now() + (2 + round * 2) * 3600000);
    const input = { facilityId, subUnitId: laneId, walkInName: "Synthetic", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString() };
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => createBooking({ tenantId, userId }, input)));
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    rejected.push(...errors.map((r) => codes(r.reason)));
    if (errors.length) break;
    const values = results.flatMap((r) => r.status === "fulfilled" ? [r.value] : []);
    expect(values.filter((r) => r.ok)).toHaveLength(1);
    expect(values.filter((r) => !r.ok && r.error === SLOT_TAKEN_ERROR)).toHaveLength(49);
  }
  expect(rejected).toEqual([]);
}, 60000);

it("waits for the facility booking lock before inserting", async () => {
  const holder = await admin.connect();
  let request: ReturnType<typeof createBooking> | undefined;
  let observed = false;
  try {
    await holder.query("begin");
    const pid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    await holder.query("select id from facilities where id=$1 for no key update", [facilityId]);
    const start = new Date(Date.now() + 20 * 3600000);
    request = createBooking({ tenantId, userId }, { facilityId, subUnitId: laneId, walkInName: "Synthetic", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString() });
    void request.catch(() => {});
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await holder.query("select pg_stat_clear_snapshot()");
      const waiting = await holder.query("select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and wait_event_type='Lock'", [pid]);
      if (waiting.rowCount) { observed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await holder.query("rollback");
    holder.release();
  }
  const result = await request;
  expect(result?.ok).toBe(true);
  expect(observed).toBe(true);
}, 10000);

it("does not serialize a different facility behind the held facility lock", async () => {
  const holder = await admin.connect();
  let request: ReturnType<typeof createBooking> | undefined;
  let completedBeforeRelease = false;
  try {
    await holder.query("begin");
    await holder.query("select id from facilities where id=$1 for no key update", [facilityId]);
    const start = new Date(Date.now() + 22 * 3600000);
    request = createBooking({ tenantId, userId }, { facilityId: otherFacilityId, walkInName: "Synthetic", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString() });
    const outcome = await Promise.race([request.then(() => "completed"), new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 2000))]);
    completedBeforeRelease = outcome === "completed";
  } finally {
    await holder.query("rollback");
    holder.release();
  }
  expect((await request)?.ok).toBe(true);
  expect(completedBeforeRelease).toBe(true);
}, 10000);
