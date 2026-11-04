import { afterAll, beforeAll, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone, zonedWallTimeToInstant } from "@/lib/time/tz";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { createBooking, SLOT_TAKEN_ERROR } from "@/lib/services/bookings";
import { saveBookingPriceRule } from "@/lib/services/booking-price-admin";

const tenant = asTenantId(uuidv7());
const actor = asUserId(uuidv7());
const location = uuidv7();
const facility = uuidv7();
const lane = uuidv7();
const laneB = uuidv7();
const secondFacility = uuidv7();
const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };
const date = addDays(todayInZone("Asia/Kolkata"), 1);
const instant = (time: string) => zonedWallTimeToInstant(date, time, "Asia/Kolkata").toISOString();

beforeAll(async () => {
  await admin.query("insert into tenants (id, slug, name, status, timezone) values ($1,$2,'Conflict fixture','active','Asia/Kolkata')", [tenant, `conflict-${tenant}`]);
  await admin.query("insert into locations (id, tenant_id, name, is_primary) values ($1,$2,'Site',true)", [location, tenant]);
  await admin.query("insert into facilities (id, tenant_id, location_id, name, kind, capacity) values ($1,$2,$3,'Court','court',4)", [facility, tenant, location]);
  await admin.query("insert into facilities (id, tenant_id, location_id, name, kind, capacity) values ($1,$2,$3,'Second','court',4)", [secondFacility, tenant, location]);
  await admin.query("insert into facility_sub_units (id, tenant_id, facility_id, name) values ($1,$3,$4,'Lane'),($2,$3,$4,'Lane B')", [lane, laneB, tenant, facility]);
  await admin.query("insert into users (id, phone) values ($1,$2)", [actor, `+91${String(BigInt('0x' + actor.replaceAll('-', '').slice(-8)) % 10000000000n).padStart(10, '0')}`]);
  await admin.query("insert into tenant_features (tenant_id, feature_key, enabled) values ($1,'pool.booking',true)", [tenant]);
  const rate = await saveBookingPriceRule(ctx, { label: "Rate", facilityId: facility, pricePaise: 20000 });
  expect(rate.ok).toBe(true);
});

afterAll(async () => {
  await admin.query("delete from bookings where tenant_id=$1", [tenant]);
  await admin.query("delete from booking_price_rules where tenant_id=$1", [tenant]);
  await admin.query("delete from facility_sub_units where tenant_id=$1", [tenant]);
  await admin.query("delete from facilities where tenant_id=$1", [tenant]);
  await admin.query("delete from locations where tenant_id=$1", [tenant]);
  await admin.query("delete from tenants where id=$1", [tenant]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end();
});

it("rejects a lane booking overlapping a confirmed whole-facility booking", async () => {
  const input = { facilityId: facility, walkInName: "Synthetic guest", startsAt: instant("10:00"), endsAt: instant("11:00") };
  const whole = await createBooking(ctx, input);
  expect(whole.ok).toBe(true);
  const before = await admin.query("select (select count(*)::int from bookings where tenant_id=$1) bookings, (select count(*)::int from audit_log where tenant_id=$1 and action='booking.create') audits, (select count(*)::int from invoices where tenant_id=$1) invoices", [tenant]);
  const child = await createBooking(ctx, { ...input, subUnitId: lane });
  expect(child).toEqual({ ok: false, error: SLOT_TAKEN_ERROR });
  const after = await admin.query("select (select count(*)::int from bookings where tenant_id=$1) bookings, (select count(*)::int from audit_log where tenant_id=$1 and action='booking.create') audits, (select count(*)::int from invoices where tenant_id=$1) invoices", [tenant]);
  expect(after.rows).toEqual(before.rows);
});


it("rejects a whole-facility booking overlapping a confirmed lane", async () => {
  const input = { facilityId: facility, walkInName: "Synthetic guest", startsAt: instant("12:00"), endsAt: instant("13:00") };
  expect((await createBooking(ctx, { ...input, subUnitId: lane })).ok).toBe(true);
  expect((await createBooking(ctx, input)).ok).toBe(false);
});

it("allows adjacent half-open slots on the same lane", async () => {
  const input = { facilityId: facility, subUnitId: lane, walkInName: "Synthetic guest", startsAt: instant("14:00"), endsAt: instant("15:00") };
  expect((await createBooking(ctx, input)).ok).toBe(true);
  expect((await createBooking(ctx, { ...input, startsAt: instant("15:00"), endsAt: instant("16:00") })).ok).toBe(true);
});

it("admits only one concurrent whole-versus-lane request", async () => {
  const input = { facilityId: facility, walkInName: "Synthetic guest", startsAt: instant("17:00"), endsAt: instant("18:00") };
  const results = await Promise.all([createBooking(ctx, input), createBooking(ctx, { ...input, subUnitId: lane })]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
});


async function direct(subUnit: string | null, start: string, end: string, status = "confirmed", resource = facility) {
  return withTenant(tenant, tx => tx.execute(sql`insert into bookings (id,tenant_id,location_id,facility_id,sub_unit_id,walk_in_name,starts_at,ends_at,status,price_paise) values (${uuidv7()}::uuid,${tenant}::uuid,${location}::uuid,${resource}::uuid,${subUnit}::uuid,'DB fixture',${instant(start)}::timestamptz,${instant(end)}::timestamptz,${status},0)`));
}
it("app_login DB rejects a child overlapping a held whole facility", async () => {
  await direct(null,"19:00","20:00","held");
  await expect(direct(lane,"19:00","20:00")).rejects.toThrow();
});
it("app_login DB rejects whole overlapping a held child", async () => {
  await direct(lane,"20:00","21:00","held");
  await expect(direct(null,"20:00","21:00")).rejects.toThrow();
});
it("app_login DB admits different children and different facilities and cancelled slots", async () => {
  await direct(lane,"21:00","22:00");
  await direct(laneB,"21:00","22:00");
  await direct(null,"21:00","22:00","confirmed",secondFacility);
  await direct(null,"22:00","23:00","cancelled");
  await direct(lane,"22:00","23:00");
});
it("app_login DB excludes the same child in overlapping slots", async () => {
  await direct(lane,"06:00","07:00");
  await expect(direct(lane,"06:00","07:00")).rejects.toThrow();
});
