import { afterAll, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client, Pool } from "pg";
import { v7 as uuid } from "uuid";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { runMigrations } from "@/db/migrate";

const target = "20261101000000_booking_whole_conflicts.sql";
let container: StartedPostgreSqlContainer | undefined;
let admin: Pool | undefined;
let app: Client | undefined;

afterAll(async () => {
  await app?.end();
  await admin?.end();
  await container?.stop();
});

it("refuses legacy collisions atomically, then applies once and enforces as app_login", async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const uri = container.getConnectionUri();
  const password = "fixture-only-password";
  await bootstrapRoles(uri, password);
  await runMigrations(uri, { upToExclusive: target });
  admin = new Pool({ connectionString: uri });
  const tenant = uuid(), location = uuid(), facility = uuid(), lane = uuid();
  const whole = uuid(), child = uuid();
  await admin.query("insert into tenants(id,slug,name,status) values ($1,$2,'Fixture','active')", [tenant, `mig-${tenant}`]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values ($1,$2,'Site',true)", [location, tenant]);
  await admin.query("insert into facilities(id,tenant_id,location_id,name,kind,capacity) values ($1,$2,$3,'Court','court',4)", [facility, tenant, location]);
  await admin.query("insert into facility_sub_units(id,tenant_id,facility_id,name) values ($1,$2,$3,'Lane')", [lane, tenant, facility]);
  await admin.query(`insert into bookings(id,tenant_id,location_id,facility_id,sub_unit_id,walk_in_name,starts_at,ends_at,status,price_paise)
    values ($1,$3,$4,$5,null,'Whole','2030-01-01 10:00Z','2030-01-01 11:00Z','held',0),
    ($2,$3,$4,$5,$6,'Lane','2030-01-01 10:00Z','2030-01-01 11:00Z','confirmed',0)`, [whole, child, tenant, location, facility, lane]);
  await expect(runMigrations(uri)).rejects.toThrow("booking overlap preflight failed");
  const rollback = await admin.query(`select
    (select count(*)::int from bookings where tenant_id=$1) as rows,
    (select count(*)::int from pg_constraint where conname='bookings_no_overlap_excl') as old,
    (select count(*)::int from pg_constraint where conname='bookings_whole_child_no_overlap_excl') as new,
    (select count(*)::int from pg_type where typname='booking_subunit_uuid_range') as type,
    (select count(*)::int from _migrations where name=$2) as applied`, [tenant, target]);
  expect(rollback.rows[0]).toEqual({ rows: 2, old: 1, new: 0, type: 0, applied: 0 });
  // Resolve only this synthetic conflict after proving rollback; no customer rows.
  await admin.query("update bookings set status='cancelled' where id=$1", [child]);
  expect(await runMigrations(uri)).toBe(1);
  expect(await runMigrations(uri)).toBe(0);
  const state = await admin.query("select (select count(*)::int from pg_constraint where conname='bookings_no_overlap_excl') as old, (select count(*)::int from pg_constraint where conname='bookings_whole_child_no_overlap_excl') as new");
  expect(state.rows[0]).toEqual({ old: 0, new: 1 });
  const appUri = new URL(uri); appUri.username = "app_login"; appUri.password = password;
  app = new Client({ connectionString: appUri.toString() });
  await app.connect();
  await app.query("set role app_user");
  await app.query("begin");
  await app.query("select set_config('app.tenant_id',$1,true)", [tenant]);
  const range = await app.query("select booking_subunit_uuid_range(null,null,'[]') && booking_subunit_uuid_range($1::uuid,$1::uuid,'[]') as overlaps", [lane]);
  expect(range.rows[0].overlaps).toBe(true);
  await expect(app.query(`insert into bookings(id,tenant_id,location_id,facility_id,sub_unit_id,walk_in_name,starts_at,ends_at,status,price_paise)
    values ($1,$2,$3,$4,$5,'Attempt','2030-01-01 10:00Z','2030-01-01 11:00Z','confirmed',0)`, [uuid(), tenant, location, facility, lane])).rejects.toMatchObject({ code: "23P01" });
  await app.query("rollback");
  await app.query("begin");
  await app.query("select set_config('app.tenant_id',$1,true)", [tenant]);
  await app.query(`insert into bookings(id,tenant_id,location_id,facility_id,sub_unit_id,walk_in_name,starts_at,ends_at,status,price_paise)
    values ($1,$2,$3,$4,$5,'Allowed','2030-01-01 11:00Z','2030-01-01 12:00Z','confirmed',0)`, [uuid(), tenant, location, facility, lane]);
  await app.query("commit");
}, 180_000);
