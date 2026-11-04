import { afterAll, beforeAll, expect, it } from 'vitest';
import { v7 as uuid } from 'uuid';
import { privilegedFixturePool as admin } from '../db/privileged-fixture';
import { asTenantId, asUserId } from '@/lib/ids';
import { createBatch, updateBatch, deleteBatch } from '@/lib/services/programs';
const tenant = asTenantId(uuid()), other = asTenantId(uuid()), actor = asUserId(uuid());
const a = uuid(), b = uuid(), role = uuid(), membership = uuid(), program = uuid(), foreignProgram = uuid();
const hidden = uuid(), hiddenDelete = uuid(), allowed = uuid(), deleted = uuid(), foreignBatch = uuid();
const ctx = { tenantId: tenant, userId: actor, roleKey: 'admin' };
const fields = { programId: program, name: 'Test', capacity: 4, daysOfWeek: [] as number[], startTime: '10:00', endTime: '11:00' };
beforeAll(async () => {
  await admin.query("insert into tenants (id,slug,name,status,timezone) values ($1,$2,'Test','active','Asia/Kolkata'),($3,$4,'Other','active','Asia/Kolkata')", [tenant, `batch-${tenant}`, other, `batch-${other}`]);
  await admin.query("insert into locations (id,tenant_id,name,is_primary) values ($1,$3,'A',false),($2,$3,'B',true)", [a, b, tenant]);
  await admin.query("insert into users (id,phone) values ($1,$2)", [actor, `+91${String(BigInt('0x' + actor.replaceAll('-', '').slice(-8))).padStart(10, '0')}`]);
  await admin.query("insert into roles (id,tenant_id,key,name) values ($1,$2,'admin','Admin')", [role, tenant]);
  await admin.query("insert into tenant_memberships (id,tenant_id,user_id,role_id,all_locations,status) values ($1,$2,$3,$4,false,'active')", [membership, tenant, actor, role]);
  await admin.query("insert into membership_locations (id,tenant_id,membership_id,location_id) values ($1,$2,$3,$4)", [uuid(), tenant, membership, a]);
  await admin.query("insert into config_values (key,scope_type,scope_id,tenant_id,value) values ('access.location_scoped_staff','tenant',$1::text,$1::uuid,'true'::jsonb)", [tenant]);
  await admin.query("insert into programs (id,tenant_id,name) values ($1,$3,'Program'),($2,$4,'Foreign')", [program, foreignProgram, tenant, other]);
  await admin.query("insert into batches (id,tenant_id,program_id,name,capacity,days_of_week,start_time,end_time,location_id,deleted_at) values ($1,$6,$8,'Hidden',4,'{}','10:00','11:00',$9,null),($2,$6,$8,'Hidden delete',4,'{}','10:00','11:00',$9,null),($3,$6,$8,'Allowed',4,'{}','10:00','11:00',$10,null),($4,$6,$8,'Deleted',4,'{}','10:00','11:00',$10,now()),($5,$7,$11,'Foreign',4,'{}','10:00','11:00',null,null)", [hidden, hiddenDelete, allowed, deleted, foreignBatch, tenant, other, program, b, a, foreignProgram]);
});
afterAll(async () => {
  // Keep the audited synthetic actor: immutable audit history references it.
  await admin.query("delete from batches where tenant_id = any($1::uuid[])", [[tenant, other]]);
  await admin.query("delete from programs where tenant_id = any($1::uuid[])", [[tenant, other]]);
  await admin.query("delete from membership_locations where tenant_id=$1", [tenant]);
  await admin.query("delete from tenant_memberships where tenant_id=$1", [tenant]);
  await admin.query("delete from roles where tenant_id=$1", [tenant]);
  await admin.query("delete from config_values where tenant_id=$1", [tenant]);
  await admin.query("delete from locations where tenant_id=$1", [tenant]);
  await admin.query("delete from tenants where id = any($1::uuid[])", [[tenant, other]]);
  await admin.end();
  const client = await import('@/db/client');
  await client.pool.end();
});
it("refuses update of hidden source", async () => {
  expect((await updateBatch(ctx, { ...fields, batchId: hidden, locationId: a })).ok).toBe(false);
});
it("refuses deletion of hidden source", async () => {
  expect((await deleteBatch(ctx, hiddenDelete)).ok).toBe(false);
});
it("refuses move from allowed source to hidden destination", async () => {
  expect((await updateBatch(ctx, { ...fields, batchId: allowed, locationId: b })).ok).toBe(false);
});
it("refuses create at hidden location", async () => {
  await expect(createBatch(ctx, { ...fields, locationId: b })).rejects.toThrow();
});
it("refuses create defaulting to hidden primary", async () => {
  await expect(createBatch(ctx, fields)).rejects.toThrow();
});
it("allows update in assigned location", async () => {
  expect((await updateBatch(ctx, { ...fields, batchId: allowed, locationId: a })).ok).toBe(true);
});
it("rejects other tenant and deleted batch IDs", async () => {
  expect((await deleteBatch(ctx, foreignBatch)).ok).toBe(false);
  expect((await deleteBatch(ctx, deleted)).ok).toBe(false);
});
it("allows creation at an assigned location", async () => {
  expect((await createBatch(ctx, { ...fields, locationId: a })).locationId).toBe(a);
});
it("allows unrestricted scope and disabled flag", async () => {
  expect((await updateBatch({ ...ctx, allLocations: true, locationIds: [] }, {
  ...fields, batchId: hidden, locationId: b,
  })).ok).toBe(true);
  await admin.query("update config_values set value='false'::jsonb where tenant_id=$1 and key='access.location_scoped_staff'", [tenant]);
  expect((await deleteBatch(ctx, hiddenDelete)).ok).toBe(true);
});
