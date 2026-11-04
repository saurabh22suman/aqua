import { afterAll, beforeAll, expect, it } from "vitest";
import { v7 as uuid } from "uuid";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone, zonedWallTimeToInstant } from "@/lib/time/tz";
import { createBooking } from "@/lib/services/bookings";
import { saveBookingPriceRule } from "@/lib/services/booking-price-admin";
import { withTenant } from "@/db/tenant";
import { sql } from "drizzle-orm";
const tenant = asTenantId(uuid()), foreign = asTenantId(uuid()), actor = asUserId(uuid());
const a = uuid(), b = uuid(), f = uuid(), facility = uuid(), role = uuid(), membership = uuid();
const personA = uuid(), personB = uuid(), personF = uuid(), memberA = uuid(), memberB = uuid(), memberF = uuid();
const context = { tenantId: tenant, userId: actor, roleKey: "receptionist", requestId: uuid() };
const date = addDays(todayInZone("Asia/Kolkata"), 1);
const slot = (hour: number, memberId: string) => ({ facilityId: facility, memberId, startsAt: zonedWallTimeToInstant(date, `${String(hour).padStart(2, "0")}:00`, "Asia/Kolkata").toISOString(), endsAt: zonedWallTimeToInstant(date, `${String(hour).padStart(2, "0")}:30`, "Asia/Kolkata").toISOString() });
async function counts() {
    return withTenant(tenant, async (tx) => {
        const result = await tx.execute(sql `select (select count(*)::int from bookings where tenant_id = ${tenant}::uuid) as bookings, (select count(*)::int from audit_log where tenant_id = ${tenant}::uuid and action = 'booking.create') as audits, (select count(*)::int from invoices where tenant_id = ${tenant}::uuid) as invoices`);
        return result.rows[0];
    });
}
beforeAll(async () => {
    await admin.query("insert into tenants (id, slug, name, status, timezone) values ($1,$2,'Scoped test','active','Asia/Kolkata'),($3,$4,'Foreign test','active','Asia/Kolkata')", [tenant, `ref-${tenant}`, foreign, `ref-${foreign}`]);
    await admin.query("insert into locations (id,tenant_id,name,is_primary) values ($1,$4,'A',true),($2,$4,'B',false),($3,$5,'Foreign',true)", [a, b, f, tenant, foreign]);
    await admin.query("insert into facilities (id,tenant_id,location_id,name,kind,capacity) values ($1,$2,$3,'Court','court',4)", [facility, tenant, a]);
    await admin.query("insert into users (id,phone) values ($1,$2)", [actor, `+91${String(BigInt('0x' + actor.replaceAll('-', '').slice(-8))).padStart(10, '0')}`]);
    await admin.query("insert into roles (id,tenant_id,key,name,home_path,home_ordinal) values ($1,$2,'receptionist','Receptionist','/reception',3)", [role, tenant]);
    await admin.query("insert into tenant_memberships (id,tenant_id,user_id,role_id,all_locations,status) values ($1,$2,$3,$4,false,'active')", [membership, tenant, actor, role]);
    await admin.query("insert into membership_locations (id,tenant_id,membership_id,location_id) values ($1,$2,$3,$4)", [uuid(), tenant, membership, a]);
    await admin.query("insert into persons (id,tenant_id,full_name) values ($1,$4,'A'),($2,$4,'B'),($3,$5,'F')", [personA, personB, personF, tenant, foreign]);
    await admin.query("insert into members (id,tenant_id,person_id,location_id,member_code,status) values ($1,$7,$4,$9,$12,'active'),($2,$7,$5,$10,$13,'active'),($3,$8,$6,$11,$14,'active')", [memberA, memberB, memberF, personA, personB, personF, tenant, foreign, a, b, f, `a-${memberA}`, `b-${memberB}`, `f-${memberF}`]);
    await admin.query("insert into tenant_features (tenant_id,feature_key,enabled) values ($1,'pool.booking',true)", [tenant]);
    expect((await saveBookingPriceRule(context, { label: 'Rate', facilityId: facility, pricePaise: 20000 })).ok).toBe(true);
    await admin.query("insert into config_values (key,scope_type,scope_id,tenant_id,value) values ('access.location_scoped_staff','tenant',$1::text,$1::uuid,'true'::jsonb)", [tenant]);
});
afterAll(async () => {
    // Audit history is immutable and references the synthetic actor; retain that user.
    await admin.query("delete from bookings where tenant_id=$1", [tenant]);
    await admin.query("delete from booking_price_rules where tenant_id=$1", [tenant]);
    await admin.query("delete from membership_locations where tenant_id=$1", [tenant]);
    await admin.query("delete from tenant_memberships where tenant_id=$1", [tenant]);
    await admin.query("delete from roles where tenant_id=$1", [tenant]);
    await admin.query("delete from members where tenant_id = any($1::uuid[])", [[tenant, foreign]]);
    await admin.query("delete from persons where tenant_id = any($1::uuid[])", [[tenant, foreign]]);
    await admin.query("delete from facilities where tenant_id=$1", [tenant]);
    await admin.query("delete from config_values where tenant_id=$1", [tenant]);
    await admin.query("delete from locations where tenant_id = any($1::uuid[])", [[tenant, foreign]]);
    await admin.query("delete from tenants where id = any($1::uuid[])", [[tenant, foreign]]);
    await admin.end();
    const client = await import('@/db/client');
    await client.pool.end();
});
it('denies hidden same-tenant member through membership fallback without side effects', async () => {
    const before = await counts();
    const result = await createBooking(context, slot(8, memberB));
    const after = await counts();
    expect(after).toEqual(before);
    expect(result.ok).toBe(false);
});
it('denies hidden same-tenant member with a fully supplied scoped context', async () => {
    const before = await counts();
    const result = await createBooking({ ...context, allLocations: false, locationIds: [a], permissions: new Set(['bookings.write']) }, slot(9, memberB));
    const after = await counts();
    expect(after).toEqual(before);
    expect(result.ok).toBe(false);
});
it("permits the assigned-location member", async () => {
  expect((await createBooking(context, slot(10, memberA))).ok).toBe(true);
});
it("rejects a foreign-tenant member without side effects", async () => {
  const before = await counts();
  expect((await createBooking(context, slot(11, memberF))).ok).toBe(false);
  expect(await counts()).toEqual(before);
});
it("permits a hidden-location member for an unrestricted caller", async () => {
  const unrestricted = { ...context, allLocations: true, locationIds: [] };
  expect((await createBooking(unrestricted, slot(12, memberB))).ok).toBe(true);
});
it("permits a hidden-location member with the flag off", async () => {
  await admin.query("update config_values set value='false'::jsonb where tenant_id=$1 and key='access.location_scoped_staff'", [tenant]);
  expect((await createBooking(context, slot(13, memberB))).ok).toBe(true);
});
