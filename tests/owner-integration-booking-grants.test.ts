import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "./db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";
import { listBookingsForDay } from "@/lib/services/booking-list";

// Supplementary integration regression. Real persisted membership/grants feed
// the runtime service fallback; no injected allLocations/locationIds fast path.
// This does not retroactively establish the calendar builder's historical RED.
const run = Date.now().toString(36);
const tenant = asTenantId(uuidv7());
const foreignTenant = asTenantId(uuidv7());
const locA = uuidv7(), locB = uuidv7(), foreignLoc = uuidv7();
const facilityA = uuidv7(), facilityB = uuidv7(), foreignFacility = uuidv7();
const carryA = uuidv7(), carryB = uuidv7(), foreignCarry = uuidv7(), ordinaryA = uuidv7();
const scopedUser = asUserId(uuidv7()), noGrantUser = asUserId(uuidv7());
const ownerUser = asUserId(uuidv7()), foreignOwner = asUserId(uuidv7()), outsider = asUserId(uuidv7());
const scopedMembership = uuidv7();
const ctx = (tenantId: typeof tenant, userId: typeof scopedUser) => ({tenantId,userId,requestId:uuidv7()});
const day = "2026-11-03";

beforeAll(async () => {
  await admin.query(`insert into tenants(id,slug,name,status,timezone) values
    ($1,$3,'Integration scoped academy','active','Asia/Kolkata'),
    ($2,$4,'Integration other academy','active','Asia/Kolkata')`,
  [tenant,foreignTenant,`int-grants-${run}`,`int-foreign-${run}`]);
  await seedRoleTemplates(tenant);
  await seedRoleTemplates(foreignTenant);
  await admin.query(`insert into locations(id,tenant_id,name,is_primary) values
    ($1,$4,'Granted site',true),($2,$4,'Denied site',false),($3,$5,'Other tenant site',true)`,
  [locA,locB,foreignLoc,tenant,foreignTenant]);
  await admin.query(`insert into facilities(id,tenant_id,location_id,name,kind,capacity) values
    ($1,$4,$6,'Granted court','court',4),($2,$4,$7,'Denied court','court',4),
    ($3,$5,$8,'Other tenant court','court',4)`,
  [facilityA,facilityB,foreignFacility,tenant,foreignTenant,locA,locB,foreignLoc]);
  const users = [scopedUser,noGrantUser,ownerUser,foreignOwner,outsider];
  for (const [index,user] of users.entries()) {
    await admin.query("insert into users(id,phone) values($1,$2)",
      [user,`+919${String(Date.now()).slice(-8)}${index}`]);
  }
  for (const row of [
    {id:scopedMembership,tenant,user:scopedUser,role:"receptionist",all:false},
    {id:uuidv7(),tenant,user:noGrantUser,role:"receptionist",all:false},
    {id:uuidv7(),tenant,user:ownerUser,role:"owner",all:true},
    {id:uuidv7(),tenant:foreignTenant,user:foreignOwner,role:"owner",all:true},
  ]) {
    const inserted = await admin.query(`insert into tenant_memberships(id,tenant_id,user_id,role_id,all_locations,status)
      select $1,$2,$3,id,$5,'active' from roles where tenant_id=$2 and key=$4 returning id`,
    [row.id,row.tenant,row.user,row.role,row.all]);
    expect(inserted.rowCount).toBe(1);
  }
  await admin.query(`insert into membership_locations(id,tenant_id,membership_id,location_id) values($1,$2,$3,$4)`,
    [uuidv7(),tenant,scopedMembership,locA]);
  for (const id of [tenant,foreignTenant]) {
    await admin.query(`insert into config_values(key,scope_type,scope_id,tenant_id,value)
      values('access.location_scoped_staff','tenant',$1,$2,'true'::jsonb)`,[id,id]);
  }
  for (const row of [
    {id:carryA,tenant,loc:locA,facility:facilityA},
    {id:carryB,tenant,loc:locB,facility:facilityB},
    {id:foreignCarry,tenant:foreignTenant,loc:foreignLoc,facility:foreignFacility},
  ]) {
    await admin.query(`insert into bookings(id,tenant_id,location_id,facility_id,walk_in_name,starts_at,ends_at,status,price_paise)
      values($1,$2,$3,$4,'Synthetic integration guest','2026-11-02T23:00:00+05:30','2026-11-03T00:30:00+05:30','confirmed',0)`,
    [row.id,row.tenant,row.loc,row.facility]);
  }
  await admin.query(`insert into bookings(id,tenant_id,location_id,facility_id,walk_in_name,starts_at,ends_at,status,price_paise)
    values($1,$2,$3,$4,'Synthetic same-day control','2026-11-03T10:00:00+05:30','2026-11-03T11:00:00+05:30','confirmed',0)`,
  [ordinaryA,tenant,locA,facilityA]);
},60_000);

afterAll(async () => {
  for (const id of [tenant,foreignTenant]) {
    await admin.query("delete from bookings where tenant_id=$1",[id]);
    await admin.query("delete from membership_locations where tenant_id=$1",[id]);
    await admin.query("delete from tenant_memberships where tenant_id=$1",[id]);
    await admin.query("delete from config_values where tenant_id=$1",[id]);
    await admin.query("delete from role_permissions where tenant_id=$1",[id]);
    await admin.query("delete from roles where tenant_id=$1",[id]);
    await admin.query("delete from facilities where tenant_id=$1",[id]);
    await admin.query("delete from locations where tenant_id=$1",[id]);
    await admin.query("delete from tenants where id=$1",[id]);
  }
  await admin.query("delete from users where id=any($1::uuid[])",
    [[scopedUser,noGrantUser,ownerUser,foreignOwner,outsider]]);
},60_000);

describe("booking overlap reads preserve persisted location grants and tenant RLS", () => {
  it("returns the granted carry-over plus same-day positive control, excluding the denied site",async () => {
    const rows = await listBookingsForDay(ctx(tenant,scopedUser),{date:day});
    expect(rows.map(row=>row.bookingId).sort()).toEqual([carryA,ordinaryA].sort());
  });
  it("cannot widen a grant with an explicit denied location or facility",async () => {
    expect(await listBookingsForDay(ctx(tenant,scopedUser),{date:day,locationId:locB})).toEqual([]);
    expect(await listBookingsForDay(ctx(tenant,scopedUser),{date:day,facilityId:facilityB})).toEqual([]);
    const rows = await listBookingsForDay(ctx(tenant,scopedUser),{date:day,locationId:locA});
    expect(rows.map(row=>row.bookingId)).toContain(carryA);
  });
  it("denies identified humans with no grants or no membership",async () => {
    expect(await listBookingsForDay(ctx(tenant,noGrantUser),{date:day})).toEqual([]);
    expect(await listBookingsForDay(ctx(tenant,outsider),{date:day})).toEqual([]);
    expect(await listBookingsForDay(ctx(foreignTenant,scopedUser),{date:day})).toEqual([]);
  });
  it("keeps simultaneous real owner membership reads in their own tenant",async () => {
    const [own,foreign] = await Promise.all([
      listBookingsForDay(ctx(tenant,ownerUser),{date:day}),
      listBookingsForDay(ctx(foreignTenant,foreignOwner),{date:day}),
    ]);
    expect(own.map(row=>row.bookingId).sort()).toEqual([carryA,carryB,ordinaryA].sort());
    expect(foreign.map(row=>row.bookingId)).toEqual([foreignCarry]);
  });
});
