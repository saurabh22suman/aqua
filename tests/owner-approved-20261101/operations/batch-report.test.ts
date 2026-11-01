import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { privilegedFixturePool as admin } from "@/tests/db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { getOwnerBatchReport } from "@/lib/services/owner-batch-report";

const tenant = asTenantId(randomUUID()), other = asTenantId(randomUUID());
const a = randomUUID(), b = randomUUID(), foreign = randomUUID();
const p = randomUUID(), p2 = randomUUID(), batch = randomUUID(), hidden = randomUUID(), dead = randomUUID(), cross = randomUUID();
const person = randomUUID(), member = randomUUID(), person2 = randomUUID(), member2 = randomUUID(), userId = asUserId(randomUUID());
const ctx = { tenantId: tenant, userId, roleKey: "owner", permissions: new Set(["reports.operational"]), allLocations: false, locationIds: [a] };

beforeAll(async () => {
  await admin.query("insert into tenants (id, slug, name, status) values ($1,$3,'Batch report','active'),($2,$4,'Other','active')", [tenant, other, `batch-${tenant}`, `batch-${other}`]);
  await admin.query("insert into tenant_features (tenant_id, feature_key, enabled) values ($1,'reports',true),($2,'reports',true)", [tenant, other]);
  await admin.query("insert into config_values(key,scope_type,scope_id,tenant_id,value) values ('access.location_scoped_staff','tenant',$1,$2,'true'::jsonb)", [tenant,tenant]);
  await admin.query("insert into locations (id,tenant_id,name,is_primary) values ($1,$4,'A',true),($2,$4,'B',false),($3,$5,'Other',true)", [a,b,foreign,tenant,other]);
  await admin.query("insert into programs (id,tenant_id,name) values ($1,$3,'Program'),($2,$4,'Foreign')", [p,p2,tenant,other]);
  await admin.query(`insert into batches (id,tenant_id,program_id,location_id,name,capacity,start_time,end_time,deleted_at) values
    ($1,$5,$7,$9,'Visible',1,'07:00','08:00',null),($2,$5,$7,$10,'Hidden',8,'07:00','08:00',null),
    ($3,$5,$7,$9,'Deleted',8,'07:00','08:00',now()),($4,$6,$8,$11,'Foreign',8,'07:00','08:00',null)`, [batch,hidden,dead,cross,tenant,other,p,p2,a,b,foreign]);
  await admin.query("insert into persons (id,tenant_id,full_name) values ($1,$3,'Synthetic'),($2,$3,'Synthetic 2')", [person,person2,tenant]);
  await admin.query("insert into members (id,tenant_id,person_id,location_id,member_code,status) values ($1,$3,$4,$6,$7,'active'),($2,$3,$5,$6,$8,'lapsed')", [member,member2,tenant,person,person2,a,`BR-${member}`,`BR-${member2}`]);
  await admin.query("insert into enrolments (id,tenant_id,member_id,batch_id,enrolled_on) values ($1,$3,$4,$5,'2026-01-01'),($2,$3,$4,$5,'2026-02-01')", [randomUUID(),randomUUID(),tenant,member,batch]);
  await admin.query("insert into enrolments (id,tenant_id,member_id,batch_id,enrolled_on) values ($1,$2,$3,$4,'2026-01-01')", [randomUUID(),tenant,member2,batch]);
}, 60000);

afterAll(async () => {
  for (const id of [tenant,other]) {
    for (const table of ["enrolments","members","persons","batches","programs","locations","config_values","tenant_features"]) await admin.query(`delete from ${table} where tenant_id=$1`, [id]);
    await admin.query("delete from tenants where id=$1", [id]);
  }
}, 60000);

describe("batch places report scoped snapshot", () => {
  it("returns the authorized live batch with distinct reserved places and true capacity", async () => {
    const rows = await getOwnerBatchReport(ctx);
    expect(rows).toEqual([expect.objectContaining({batchId:batch, batchName:"Visible", capacity:1, reservedPlaces:2, locationId:a})]);
  });
  it("cannot widen an unseen site or an empty location grant", async () => {
    expect(await getOwnerBatchReport(ctx, b)).toEqual([]);
    expect(await getOwnerBatchReport(ctx, randomUUID())).toEqual([]);
    expect(await getOwnerBatchReport({...ctx, locationIds: []})).toEqual([]);
  });
  it("rejects a caller without the operational grant", async () => {
    await expect(getOwnerBatchReport({...ctx, permissions:new Set()})).rejects.toThrow(/forbidden/i);
  });
  it("rejects the report when its tenant feature is disabled", async () => {
    await admin.query("update tenant_features set enabled=false where tenant_id=$1 and feature_key='reports'", [tenant]);
    try { await expect(getOwnerBatchReport(ctx)).rejects.toThrow(/feature_disabled/i); }
    finally { await admin.query("update tenant_features set enabled=true where tenant_id=$1 and feature_key='reports'", [tenant]); }
  });
  it("isolates the other tenant", async () => {
    const rows = await getOwnerBatchReport({...ctx, tenantId:other, allLocations:true});
    expect(rows.map(row => row.batchId)).toEqual([cross]);
    expect(rows[0].reservedPlaces).toBe(0);
  });
});
