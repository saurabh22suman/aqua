import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { requestBookingBill } from "@/lib/services/booking-billing";
import { seedRoleTemplates } from "@/lib/services/roles";
import { setCredential } from "@/lib/services/credentials";
import { POST as loginWithPin } from "@/app/api/login/pin/route";
import { createBatchAction, updateBatchAction, deleteBatchAction } from "@/lib/actions/programs";
import { createBookingAction, quoteBookingAction, listBookableFacilitiesAction, listBookingsAction, cancelBookingAction, requestBookingBillAction, readBookingBillAction } from "@/lib/actions/bookings";
import { addDays, todayInZone, zonedWallTimeToInstant } from "@/lib/time/tz";
const { transport } = vi.hoisted(() => ({ transport: { cookie: "" } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: transport.cookie }) }));
const tenant = asTenantId(uuidv7());
const actor = asUserId(uuidv7());
const otherTenant = asTenantId(uuidv7());
const otherProgram = uuidv7();
const otherSite = uuidv7();
const deletedSite = uuidv7();
const historicalBooking = uuidv7();
const otherBatch = uuidv7();
const assignedDelete = uuidv7();
const nullBatch = uuidv7();
const siteA = uuidv7();
const siteB = uuidv7();
const program = uuidv7();
const facilityA = uuidv7();
const facilityB = uuidv7();
const memberA = uuidv7();
const memberB = uuidv7();
const personA = uuidv7();
const personB = uuidv7();
const hiddenBooking = uuidv7();
const hiddenUpdate = uuidv7();
const hiddenDelete = uuidv7();
const allowedMove = uuidv7();
const date = addDays(todayInZone("Asia/Kolkata"), 1);
const at = (hour: string) => zonedWallTimeToInstant(date, hour, "Asia/Kolkata").toISOString();
const authId = `booking-location-${actor}`;
const phone = `+91${String(BigInt(`0x${actor.replaceAll("-", "").slice(-8)}`)).padStart(10, "0")}`;
const input = {
    programId: program,
    name: "Synthetic batch",
    capacity: 4,
    daysOfWeek: [1],
    startTime: "10:00",
    endTime: "11:00",
};
async function counts() {
    const result = await admin.query(`select (select count(*)::int from batches where tenant_id=$1) as batches,
      (select count(*)::int from sessions where tenant_id=$1) as sessions,
      (select count(*)::int from audit_log where tenant_id=$1 and action like 'batch.%') as audits`, [tenant]);
    return result.rows[0];
}
beforeAll(async () => {
    const plan = await admin.query<{
        id: string;
    }>("select id from plans where is_default=true limit 1");
    await admin.query("insert into tenants(id,slug,name,status,plan_id,timezone) values ($1,$2,'Synthetic','active',$3,'Asia/Kolkata')", [tenant, `session-${tenant}`, plan.rows[0]!.id]);
    await admin.query("insert into tenants(id,slug,name,status) values ($1,$2,'Other synthetic','active')", [otherTenant, `session-${otherTenant}`]);
    await admin.query("insert into locations(id,tenant_id,name,is_primary) values ($1,$2,'Foreign',true)", [otherSite, otherTenant]);
    await seedRoleTemplates(tenant);
    await admin.query("insert into locations(id,tenant_id,name,is_primary) values ($1,$3,'A',false),($2,$3,'B',true)", [siteA, siteB, tenant]);
    await admin.query("insert into locations(id,tenant_id,name,is_primary,deleted_at) values ($1,$2,'Deleted',false,now())", [deletedSite, tenant]);
    await admin.query("insert into config_values(key,scope_type,scope_id,tenant_id,value) values ('access.location_scoped_staff','tenant',$1::text,$1::uuid,'true'::jsonb)", [tenant]);
    await admin.query("insert into ba_user(id,name,email,phone_number,phone_number_verified) values ($1,'Synthetic',$2,$3,true)", [authId, `${authId}@invalid.test`, phone]);
    await admin.query("insert into users(id,phone,better_auth_id) values ($1,$2,$3)", [actor, phone, authId]);
    await setCredential(authId, "123456");
    const roles = await admin.query<{
        id: string;
    }>("select id from roles where tenant_id=$1 and key='owner'", [tenant]);
    const membership = uuidv7();
    await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,all_locations,status) values ($1,$2,$3,$4,false,'active')", [membership, tenant, actor, roles.rows[0]!.id]);
    await admin.query("insert into membership_locations(id,tenant_id,membership_id,location_id) values ($1,$2,$3,$4)", [uuidv7(), tenant, membership, siteA]);
    await admin.query("insert into programs(id,tenant_id,name) values ($1,$2,'Program')", [program, tenant]);
    await admin.query("insert into tenant_features(tenant_id,feature_key,enabled) values ($1,'pool.booking',true) on conflict (tenant_id,feature_key) do update set enabled=true", [tenant]);
    await admin.query("insert into facilities(id,tenant_id,location_id,name,kind,capacity) values ($1,$3,$4,'A','court',4),($2,$3,$5,'B','court',4)", [facilityA, facilityB, tenant, siteA, siteB]);
    await admin.query("insert into booking_price_rules(id,tenant_id,label,price_paise) values ($1,$2,'Rate',20000)", [uuidv7(), tenant]);
    await admin.query("insert into persons(id,tenant_id,full_name) values ($1,$3,'A'),($2,$3,'B')", [personA, personB, tenant]);
    await admin.query("insert into members(id,tenant_id,person_id,location_id,member_code,status) values ($1,$3,$4,$6,$8,'active'),($2,$3,$5,$7,$9,'active')", [memberA, memberB, tenant, personA, personB, siteA, siteB, `A-${memberA}`, `B-${memberB}`]);
    await admin.query("insert into bookings(id,tenant_id,location_id,facility_id,member_id,starts_at,ends_at,status,price_paise) values ($1,$2,$3,$4,$5,$6,$7,'confirmed',20000)", [hiddenBooking, tenant, siteB, facilityB, memberB, at('12:00'), at('13:00')]);
    await admin.query("insert into bookings(id,tenant_id,location_id,facility_id,member_id,starts_at,ends_at,status,price_paise) values ($1,$2,$3,$4,$5,$6,$7,'confirmed',20000)", [historicalBooking, tenant, siteA, facilityA, memberB, at('14:00'), at('15:00')]);
    const historicalBill = await requestBookingBill({ tenantId: tenant, userId: actor, allLocations: true, locationIds: [] }, historicalBooking);
    expect(historicalBill.ok).toBe(true);
    await admin.query("insert into batches(id,tenant_id,program_id,location_id,name,capacity,days_of_week,start_time,end_time) values ($1,$4,$5,$6,'Hidden update',4,'{}','10:00','11:00'),($2,$4,$5,$6,'Hidden delete',4,'{}','10:00','11:00'),($3,$4,$5,$7,'Allowed move',4,'{}','10:00','11:00')", [hiddenUpdate, hiddenDelete, allowedMove, tenant, program, siteB, siteA]);
    await admin.query("insert into programs(id,tenant_id,name) values ($1,$2,'Foreign')", [otherProgram, otherTenant]);
    await admin.query("insert into batches(id,tenant_id,program_id,location_id,name,capacity,days_of_week,start_time,end_time) values ($1,$4,$5,$6,'Assigned delete',4,'{}','10:00','11:00'),($2,$4,$5,null,'Tenant wide',4,'{}','10:00','11:00'),($3,$7,$8,null,'Foreign',4,'{}','10:00','11:00')", [assignedDelete, nullBatch, otherBatch, tenant, program, siteA, otherTenant, otherProgram]);
    const response = await loginWithPin(new Request("http://localhost/api/login/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, pin: "123456" }) }));
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find(value => value.startsWith("better-auth.session_token="))?.split(";")[0];
    expect(cookie).toBeTruthy();
    transport.cookie = cookie!;
}, 60000);
afterAll(async () => {
    await admin.query("delete from sessions where tenant_id=$1", [tenant]);
    await admin.query("delete from bookings where tenant_id=$1", [tenant]);
    await admin.query("delete from invoice_line_items where tenant_id=$1", [tenant]);
    await admin.query("delete from invoices where tenant_id=$1", [tenant]);
    await admin.query("delete from booking_price_rules where tenant_id=$1", [tenant]);
    await admin.query("delete from facilities where tenant_id=$1", [tenant]);
    await admin.query("delete from members where tenant_id=$1", [tenant]);
    await admin.query("delete from persons where tenant_id=$1", [tenant]);
    await admin.query("delete from batches where tenant_id=any($1::uuid[])", [[tenant, otherTenant]]);
    await admin.query("delete from programs where tenant_id=any($1::uuid[])", [[tenant, otherTenant]]);
    await admin.query("delete from membership_locations where tenant_id=$1", [tenant]);
    await admin.query("delete from tenant_memberships where tenant_id=$1", [tenant]);
    await admin.query("delete from roles where tenant_id=$1", [tenant]);
    await admin.query("delete from config_values where tenant_id=$1", [tenant]);
    await admin.query("delete from locations where tenant_id=any($1::uuid[])", [[tenant, otherTenant]]);
    await admin.query("delete from tenants where id=any($1::uuid[])", [[tenant, otherTenant]]);
    // Immutable audit records may reference the synthetic actor; keep user and auth identity.
    await admin.end();
    const client = await import("@/db/client");
    await client.pool.end();
});
it("returns a safe result for a forbidden explicit site without side effects", async () => {
    const before = await counts();
    const result = await createBatchAction({ ...input, locationId: siteB });
    expect(result).toEqual({ ok: false, error: "Location not found." });
    expect(await counts()).toEqual(before);
});
it("returns a safe result when the default primary site is forbidden", async () => {
    const before = await counts();
    const result = await createBatchAction(input);
    expect(result).toEqual({ ok: false, error: "Location not found." });
    expect(await counts()).toEqual(before);
});
it("scoped session denies hidden member and allows visible member", async () => {
    const before = await admin.query("select (select count(*)::int from bookings where tenant_id=$1) bookings, (select count(*)::int from invoices where tenant_id=$1) invoices, (select count(*)::int from audit_log where tenant_id=$1 and action='booking.create') audits", [tenant]);
    const base = { facilityId: facilityA, startsAt: at("08:00"), endsAt: at("09:00") };
    expect(await createBookingAction({ ...base, memberId: memberB })).toMatchObject({ ok: false, error: "Member not found." });
    const after = await admin.query("select (select count(*)::int from bookings where tenant_id=$1) bookings, (select count(*)::int from invoices where tenant_id=$1) invoices, (select count(*)::int from audit_log where tenant_id=$1 and action='booking.create') audits", [tenant]);
    expect(after.rows).toEqual(before.rows);
    expect(await createBookingAction({ ...base, memberId: memberA })).toMatchObject({ ok: true });
});
it("scoped session hides the other venue and refuses its quote, cancellation and billing", async () => {
    const facilities = await listBookableFacilitiesAction();
    expect(facilities.some(row => row.id === facilityA)).toBe(true);
    expect(facilities.some(row => row.id === facilityB)).toBe(false);
    expect(await quoteBookingAction({ facilityId: facilityB, startsAt: at("12:00") })).toMatchObject({ ok: false });
    expect(await quoteBookingAction({ facilityId: facilityA, startsAt: at("12:00") })).toMatchObject({ ok: true });
    expect((await listBookingsAction({ date })).some(row => row.bookingId === hiddenBooking)).toBe(false);
    expect(await cancelBookingAction({ bookingId: hiddenBooking })).toMatchObject({ ok: false });
    expect(await requestBookingBillAction({ bookingId: hiddenBooking })).toMatchObject({ ok: false });
    expect(await readBookingBillAction({ bookingId: hiddenBooking })).toMatchObject({ ok: false });
});
async function snapshotBatch(id: string) {
    const rows = await admin.query("select id,name,location_id,deleted_at from batches where id=$1", [id]);
    return { counts: await counts(), rows: rows.rows };
}
it("denies hidden batch source update without side effects", async () => {
    const before = await snapshotBatch(hiddenUpdate);
    expect(await updateBatchAction({ ...input, batchId: hiddenUpdate, locationId: siteA })).toMatchObject({ ok: false });
    expect(await snapshotBatch(hiddenUpdate)).toEqual(before);
});
it("denies move to hidden destination without side effects", async () => {
    const before = await snapshotBatch(allowedMove);
    expect(await updateBatchAction({ ...input, batchId: allowedMove, locationId: siteB })).toMatchObject({ ok: false });
    expect(await snapshotBatch(allowedMove)).toEqual(before);
});
it("denies hidden batch deletion without side effects", async () => {
    const before = await snapshotBatch(hiddenDelete);
    expect(await deleteBatchAction(hiddenDelete)).toMatchObject({ ok: false });
    expect(await snapshotBatch(hiddenDelete)).toEqual(before);
});
it("permits an assigned primary default while scoped", async () => {
    await admin.query("update locations set is_primary=false where tenant_id=$1 and id=$2", [tenant, siteB]);
    await admin.query("update locations set is_primary=true where tenant_id=$1 and id=$2", [tenant, siteA]);
    try {
        const result = await createBatchAction(input);
        expect(result.ok).toBe(true);
        if (result.ok)
            expect(result.batch.locationId).toBe(siteA);
    }
    finally {
        await admin.query("update locations set is_primary=false where tenant_id=$1 and id=$2", [tenant, siteA]);
        await admin.query("update locations set is_primary=true where tenant_id=$1 and id=$2", [tenant, siteB]);
    }
});
for (const [label, locationId] of [["foreign", otherSite], ["deleted", deletedSite]] as const) {
    it(`denies ${label} destination for create and update without side effects`, async () => {
        const before = await snapshotBatch(allowedMove);
        expect(await createBatchAction({ ...input, locationId })).toMatchObject({ ok: false });
        expect(await snapshotBatch(allowedMove)).toEqual(before);
        expect(await updateBatchAction({ ...input, batchId: allowedMove, locationId })).toMatchObject({ ok: false });
        expect(await snapshotBatch(allowedMove)).toEqual(before);
    });
}
it("reads and re-requests an existing historical bill at an allowed venue", async () => {
    const read = await readBookingBillAction({ bookingId: historicalBooking });
    expect(read).toMatchObject({ ok: true, bill: { bookingId: historicalBooking, memberId: memberB } });
    const again = await requestBookingBillAction({ bookingId: historicalBooking });
    expect(again).toMatchObject({ ok: true, alreadyBilled: true });
    if (read.ok && again.ok)
        expect(again.bill.invoiceId).toBe(read.bill.invoiceId);
});
it("allows assigned and tenant-wide batch deletion but rejects foreign batch", async () => {
    const before = await counts();
    expect(await deleteBatchAction(otherBatch)).toMatchObject({ ok: false });
    expect(await counts()).toEqual(before);
    expect(await deleteBatchAction(assignedDelete)).toMatchObject({ ok: true });
    expect(await deleteBatchAction(nullBatch)).toMatchObject({ ok: true });
});
it("allows an unrestricted real membership", async () => {
  await admin.query("update tenant_memberships set all_locations=true where tenant_id=$1 and user_id=$2", [tenant, actor]);
  try {
    expect(await updateBatchAction({ ...input, batchId: hiddenUpdate, locationId: siteB })).toMatchObject({ ok: true });
  } finally {
    await admin.query("update tenant_memberships set all_locations=false where tenant_id=$1 and user_id=$2", [tenant, actor]);
  }
});

it("allows access when location scoping is off", async () => {
  await admin.query("update config_values set value='false'::jsonb where tenant_id=$1 and key='access.location_scoped_staff'", [tenant]);
  try {
    expect(await deleteBatchAction(hiddenDelete)).toMatchObject({ ok: true });
  } finally {
    await admin.query("update config_values set value='true'::jsonb where tenant_id=$1 and key='access.location_scoped_staff'", [tenant]);
  }
});
