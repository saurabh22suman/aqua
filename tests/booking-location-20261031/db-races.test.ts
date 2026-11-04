import { afterAll, beforeAll, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { v7 as uuid } from "uuid";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
import { env } from "@/lib/env";

const tenant = uuid(), location = uuid(), facility = uuid(), lane = uuid(), laneB = uuid();
const otherTenant = uuid(), otherLocation = uuid(), otherFacility = uuid();
const runtime = new Pool({ connectionString: env.DATABASE_URL, max: 4 });

beforeAll(async () => {
  await admin.query("insert into tenants(id,slug,name,status) values ($1,$2,'Race','active')", [tenant, `race-${tenant}`]);
  await admin.query("insert into tenants(id,slug,name,status) values ($1,$2,'Other race','active')", [otherTenant, `race-${otherTenant}`]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values ($1,$2,'Other',true)", [otherLocation,otherTenant]);
  await admin.query("insert into facilities(id,tenant_id,location_id,name,kind,capacity) values ($1,$2,$3,'Other','court',4)", [otherFacility,otherTenant,otherLocation]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values ($1,$2,'Site',true)", [location,tenant]);
  await admin.query("insert into facilities(id,tenant_id,location_id,name,kind,capacity) values ($1,$2,$3,'Court','court',4)", [facility,tenant,location]);
  await admin.query("insert into facility_sub_units(id,tenant_id,facility_id,name) values ($1,$3,$4,'A'),($2,$3,$4,'B')", [lane,laneB,tenant,facility]);
});
afterAll(async () => {
  await runtime.end();
  await admin.query("delete from bookings where tenant_id=$1", [tenant]);
  await admin.query("delete from facility_sub_units where tenant_id=$1", [tenant]);
  await admin.query("delete from facilities where tenant_id=$1", [tenant]);
  await admin.query("delete from locations where tenant_id=$1", [tenant]);
  await admin.query("delete from bookings where tenant_id=$1", [otherTenant]);
  await admin.query("delete from facilities where tenant_id=$1", [otherTenant]);
  await admin.query("delete from locations where tenant_id=$1", [otherTenant]);
  await admin.query("delete from tenants where id=any($1::uuid[])", [[tenant,otherTenant]]);
  await admin.end();
});
async function begin(isolation: string): Promise<PoolClient> {
  const client = await runtime.connect();
  await client.query("set role app_user");
  await client.query(`begin isolation level ${isolation}`);
  await client.query("set local statement_timeout='5s'");
  await client.query("set local lock_timeout='4s'");
  await client.query("select set_config('app.tenant_id',$1,true)", [tenant]);
  await client.query("select count(*) from bookings");
  return client;
}
async function insert(client: PoolClient, subunit: string | null, hour: number) {
  return client.query(`insert into bookings(id,tenant_id,location_id,facility_id,sub_unit_id,walk_in_name,starts_at,ends_at,status,price_paise)
    values ($1,$2,$3,$4,$5,'Race',make_timestamptz(2031,1,1,$6,0,0,'UTC'),make_timestamptz(2031,1,1,$6+1,0,0,'UTC'),'confirmed',0)`,
  [uuid(),tenant,location,facility,subunit,hour]);
}
async function waitForLock(pid: number) {
  for (let i = 0; i < 200; i++) {
    const state = await admin.query("select wait_event_type from pg_stat_activity where pid=$1", [pid]);
    if (state.rows[0]?.wait_event_type === "Lock") return;
  }
  throw new Error("contender did not reach a lock wait");
}
for (const [isolation, hour] of [["read committed", 2], ["repeatable read", 6]] as const) {
  for (const [first, second, offset] of [[null, lane, 0], [lane, null, 1]] as const) {
    it(`${isolation}: ${first === null ? "whole" : "child"} first blocks its contender`, async () => {
      const a = await begin(isolation), b = await begin(isolation);
      try {
        await insert(a, first, hour + offset);
        const pid = (await b.query("select pg_backend_pid() as pid")).rows[0].pid as number;
        const contender = insert(b, second, hour + offset).then(() => ({ code: "committed-insert" }), (error: { code?: string }) => ({ code: error.code }));
        await waitForLock(pid);
        await a.query("commit");
        expect(await contender).toEqual({ code: "23P01" });
        await b.query("rollback");
        const rows = await admin.query("select count(*)::int as n from bookings where tenant_id=$1 and extract(hour from starts_at at time zone 'UTC')=$2", [tenant,hour+offset]);
        expect(rows.rows[0].n).toBe(1);
      } finally {
        await a.query("rollback").catch(() => {}); await b.query("rollback").catch(() => {});
        a.release(); b.release();
      }
    });
  }
}
it("distinct lanes commit concurrently", async () => {
  const a = await begin("read committed"), b = await begin("read committed");
  try {
    await insert(a,lane,10);
    await insert(b,laneB,10);
    await Promise.all([a.query("commit"),b.query("commit")]);
    const rows = await admin.query("select count(*)::int as n from bookings where tenant_id=$1 and extract(hour from starts_at at time zone 'UTC')=10", [tenant]);
    expect(rows.rows[0].n).toBe(2);
  } finally {
    await a.query("rollback").catch(() => {}); await b.query("rollback").catch(() => {});
    a.release(); b.release();
  }
});

it("preserves nil UUID child as a real distinct child, not whole", async () => {
  const nil = "00000000-0000-0000-0000-000000000000";
  await admin.query("insert into facility_sub_units(id,tenant_id,facility_id,name) values ($1,$2,$3,'Nil')", [nil,tenant,facility]);
  const client = await begin("read committed");
  try {
    await insert(client,nil,12);
    await insert(client,lane,12);
    await client.query("commit");
  } finally { await client.query("rollback").catch(() => {}); client.release(); }
  const other = await begin("read committed");
  try { await expect(insert(other,null,12)).rejects.toMatchObject({code:"23P01"}); }
  finally { await other.query("rollback"); other.release(); }
});

it("cancelled and completed release while reactivation, resource and time changes enforce exclusion", async () => {
  const active = uuid(), inactive = uuid(), completed = uuid(), moving = uuid();
  const c = await begin("read committed");
  try {
    const sql = `insert into bookings(id,tenant_id,location_id,facility_id,sub_unit_id,walk_in_name,starts_at,ends_at,status,price_paise)
      values ($1,$2,$3,$4,$5,'Fixture',$6::timestamptz,$7::timestamptz,$8,0)`;
    await c.query(sql,[active,tenant,location,facility,null,'2032-01-01 23:30Z','2032-01-02 01:00Z','confirmed']);
    await c.query(sql,[inactive,tenant,location,facility,lane,'2032-01-02 00:00Z','2032-01-02 00:30Z','cancelled']);
    await c.query(sql,[completed,tenant,location,facility,laneB,'2032-01-02 00:00Z','2032-01-02 00:30Z','completed']);
    await c.query(sql,[moving,tenant,location,facility,lane,'2032-01-02 02:00Z','2032-01-02 03:00Z','confirmed']);
    await c.query("commit");
  } finally { await c.query("rollback").catch(()=>{}); c.release(); }
  for (const [query, args] of [
    ["update bookings set status='confirmed' where id=$1", [inactive]],
    ["update bookings set status='held' where id=$1", [completed]],
    ["update bookings set starts_at='2032-01-02 00:00Z', ends_at='2032-01-02 00:30Z' where id=$1", [moving]],
    ["update bookings set sub_unit_id=null, starts_at='2032-01-02 00:00Z', ends_at='2032-01-02 00:30Z' where id=$1", [moving]],
  ] as const) {
    const tx = await begin("read committed");
    try { await expect(tx.query(query,[...args])).rejects.toMatchObject({code:"23P01"}); }
    finally { await tx.query("rollback"); tx.release(); }
  }
  const release = await begin("read committed");
  try {
    await release.query("update bookings set status='cancelled' where id=$1",[active]);
    await release.query("update bookings set status='confirmed' where id=$1",[inactive]);
    await release.query("commit");
  } finally { await release.query("rollback").catch(()=>{}); release.release(); }
});

it("FORCE RLS denies cross-tenant inserts and permits same time at the other tenant", async () => {
  const insertOther = `insert into bookings(id,tenant_id,location_id,facility_id,walk_in_name,starts_at,ends_at,status,price_paise)
    values ($1,$2,$3,$4,'Other','2031-01-01 02:00Z','2031-01-01 03:00Z','confirmed',0)`;
  const wrong = await begin("read committed");
  try { await expect(wrong.query(insertOther,[uuid(),otherTenant,otherLocation,otherFacility])).rejects.toMatchObject({code:"42501"}); }
  finally { await wrong.query("rollback"); wrong.release(); }
  const right = await runtime.connect();
  try {
    await right.query("set role app_user"); await right.query("begin");
    await right.query("select set_config('app.tenant_id',$1,true)",[otherTenant]);
    await right.query(insertOther,[uuid(),otherTenant,otherLocation,otherFacility]);
    await right.query("commit");
  } finally { await right.query("rollback").catch(()=>{}); right.release(); }
});

it("blocks a child resource-only move into an occupied child", async () => {
  const a = uuid(), b = uuid();
  const tx = await begin("read committed");
  try {
    const q = `insert into bookings(id,tenant_id,location_id,facility_id,sub_unit_id,walk_in_name,starts_at,ends_at,status,price_paise)
      values ($1,$2,$3,$4,$5,'Move','2033-01-01 10:00Z','2033-01-01 11:00Z','confirmed',0)`;
    await tx.query(q,[a,tenant,location,facility,lane]);
    await tx.query(q,[b,tenant,location,facility,laneB]);
    await tx.query("commit");
  } finally { await tx.query("rollback").catch(()=>{}); tx.release(); }
  const attempt = await begin("read committed");
  try { await expect(attempt.query("update bookings set sub_unit_id=$1 where id=$2",[lane,b])).rejects.toMatchObject({code:"23P01"}); }
  finally { await attempt.query("rollback"); attempt.release(); }
});

it("whole-facility partial overnight overlaps fail and exact adjacency succeeds", async () => {
  const q = `insert into bookings(id,tenant_id,location_id,facility_id,sub_unit_id,walk_in_name,starts_at,ends_at,status,price_paise)
    values ($1,$2,$3,$4,$5,'Night',$6::timestamptz,$7::timestamptz,'held',0)`;
  const first = await begin("read committed");
  try {
    await first.query(q,[uuid(),tenant,location,facility,null,'2034-01-01 23:30Z','2034-01-02 00:30Z']);
    await first.query("commit");
  } finally { await first.query("rollback").catch(()=>{}); first.release(); }
  for (const unit of [null,lane]) {
    const conflict = await begin("read committed");
    try { await expect(conflict.query(q,[uuid(),tenant,location,facility,unit,'2034-01-02 00:00Z','2034-01-02 01:00Z'])).rejects.toMatchObject({code:"23P01"}); }
    finally { await conflict.query("rollback"); conflict.release(); }
  }
  const adjacent = await begin("read committed");
  try {
    await adjacent.query(q,[uuid(),tenant,location,facility,lane,'2034-01-02 00:30Z','2034-01-02 01:00Z']);
    await adjacent.query("commit");
  } finally { await adjacent.query("rollback").catch(()=>{}); adjacent.release(); }
});
