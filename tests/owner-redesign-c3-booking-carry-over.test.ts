import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "./db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";

// Owner redesign (27 October 2026) — the booking day read must see
// what is still RUNNING in the day, not only what starts in it.
//
// A booking that was taken for 23:00 yesterday and runs until 00:30
// today is still on the court at midnight. The day board, the desk's
// calendar and the phone agenda all have to be able to say so — and
// the day read is the only place that can know.
//
// The privileged pool below is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only. Every assertion runs against the application's own
// service, which connects as `app_login` under tenant RLS.
//
// The change this pins is MINIMAL and local to the read predicate:
// `starts_at < toUtc AND ends_at > fromUtc` instead of
// `starts_at >= fromUtc AND starts_at < toUtc`. Every tenant, location
// and facility filter, every join and the whole billing projection
// stay exactly as they are.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const otherTenant = asTenantId(uuidv7());
// A tenant with location scoping ON, so the read has to honour the
// caller's own locations.
const scopedTenant = asTenantId(uuidv7());
const loc = uuidv7();
const otherLoc = uuidv7();
const otherTenantLoc = uuidv7();
const scopedLocA = uuidv7();
const scopedLocB = uuidv7();
const scopedFacilityA = uuidv7();
const scopedFacilityB = uuidv7();
const scopedMemberId = uuidv7();
const scopedPersonId = uuidv7();
const facilityId = uuidv7();
const otherFacilityId = uuidv7();
// One facility per fixture booking: the overlap guarantee refuses two
// live bookings on one facility, and these rows overlap on purpose.
const extraFacilities = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const otherTenantFacility = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const actor = asUserId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };
// The scoped caller may only reach Scoped A.
const scopedCtx = {
  tenantId: scopedTenant,
  userId: actor,
  requestId: uuidv7(),
  allLocations: false,
  locationIds: [scopedLocA],
};

const TODAY = "2026-11-03"; // a Tuesday
const YESTERDAY = "2026-11-02";
const TOMORROW = "2026-11-04";

function wall(dateIso: string, time: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, hh! - 5, mm! - 30, 0)).toISOString();
}

async function insertBooking(args: {
  id: string;
  tenantId: string;
  locationId: string;
  facility: string;
  member: string | null;
  walkInName?: string | null;
  startsAt: string;
  endsAt: string;
  status?: string;
}) {
  await admin.query(
    `insert into bookings
       (id, tenant_id, location_id, facility_id, member_id, walk_in_name, starts_at, ends_at, status, price_paise)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)`,
    [
      args.id,
      args.tenantId,
      args.locationId,
      args.facility,
      args.member,
      args.walkInName ?? null,
      args.startsAt,
      args.endsAt,
      args.status ?? "confirmed",
    ],
  );
}

let service: typeof import("@/lib/services/booking-list");

beforeAll(async () => {
  service = await import("@/lib/services/booking-list");
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Carry A', 'active', $4),
       ($3, $5, 'Carry B', 'active', $4),
       ($6, $7, 'Carry Scoped', 'active', $4)`,
    [
      tenant,
      `c3-carry-a-${RUN}`,
      otherTenant,
      TZ,
      `c3-carry-b-${RUN}`,
      scopedTenant,
      `c3-carry-scoped-${RUN}`,
    ],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Carry Site', true),
       ($2, $3, 'Carry Other Site', false),
       ($4, $5, 'Carry B Site', true),
       ($6, $7, 'Scoped A', true),
       ($8, $7, 'Scoped B', false)`,
    [
      loc,
      otherLoc,
      tenant,
      otherTenantLoc,
      otherTenant,
      scopedLocA,
      scopedTenant,
      scopedLocB,
    ],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values
       ($1, $3, $4, 'Carry Court', 'court', 4),
       ($2, $3, $5, 'Carry Court Two', 'court', 4),
       ($6, $7, $8, 'Carry B Court', 'court', 4)`,
    [
      facilityId,
      otherFacilityId,
      tenant,
      loc,
      otherLoc,
      otherTenantFacility,
      otherTenant,
      otherTenantLoc,
    ],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity)
     select id, $2, $3, 'Carry Court ' || n, 'court', 4
     from unnest($1::uuid[]) with ordinality as t(id, n)`,
    [extraFacilities, tenant, loc],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values
       ($1::uuid, $2::uuid, $3::uuid, 'Scoped Court A', 'court', 4),
       ($4::uuid, $2::uuid, $5::uuid, 'Scoped Court B', 'court', 4)`,
    [scopedFacilityA, scopedTenant, scopedLocA, scopedFacilityB, scopedLocB],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Carry Member'), ($3, $4, 'Scoped Member')",
    [personId, tenant, scopedPersonId, scopedTenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [scopedMemberId, scopedTenant, scopedPersonId, scopedLocA, `C3S-${RUN}`],
  );
  // Location scoping ON for the scoped tenant.
  await admin.query(
    `insert into config_values (key, scope_type, scope_id, tenant_id, value)
     values ('access.location_scoped_staff', 'tenant', $1, $2, 'true'::jsonb)
     on conflict do nothing`,
    [scopedTenant, scopedTenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenant, personId, loc, `C3-${RUN}`],
  );
}, 60_000);

afterAll(async () => {
  for (const id of [tenant, otherTenant, scopedTenant]) {
    await admin.query("delete from bookings where tenant_id = $1", [id]);
    await admin.query("delete from invoice_line_items where tenant_id = $1", [id]);
    await admin.query("delete from payments where tenant_id = $1", [id]);
    await admin.query("delete from members where tenant_id = $1", [id]);
    await admin.query("delete from persons where tenant_id = $1", [id]);
    await admin.query("delete from facilities where tenant_id = $1", [id]);
    await admin.query("delete from locations where tenant_id = $1", [id]);
    await admin.query("delete from tenants where id = $1", [id]);
  }
}, 60_000);

describe("the booking day read sees what is running in the day", () => {
  it("returns a booking that started yesterday and is still running today", async () => {
    const id = uuidv7();
    await insertBooking({
      id,
      tenantId: tenant,
      locationId: loc,
      facility: extraFacilities[0]!,
      member: memberId,
      startsAt: wall(YESTERDAY, "23:00"),
      endsAt: wall(TODAY, "00:30"),
    });
    const rows = await service.listBookingsForDay(ctx, { date: TODAY });
    expect(rows.map((row) => row.bookingId)).toContain(id);
  });

  it("returns a booking that runs longer than a day into the day", async () => {
    const id = uuidv7();
    await insertBooking({
      id,
      tenantId: tenant,
      locationId: loc,
      facility: extraFacilities[1]!,
      member: memberId,
      startsAt: wall(YESTERDAY, "06:00"),
      endsAt: wall(TOMORROW, "06:00"),
    });
    const rows = await service.listBookingsForDay(ctx, { date: TODAY });
    expect(rows.map((row) => row.bookingId)).toContain(id);
  });

  it("excludes a booking that ends exactly when the day starts", async () => {
    const id = uuidv7();
    await insertBooking({
      id,
      tenantId: tenant,
      locationId: loc,
      facility: extraFacilities[2]!,
      member: memberId,
      startsAt: wall(YESTERDAY, "22:00"),
      endsAt: wall(TODAY, "00:00"),
    });
    const rows = await service.listBookingsForDay(ctx, { date: TODAY });
    expect(rows.map((row) => row.bookingId)).not.toContain(id);
  });

  it("keeps a booking that starts exactly when the day starts", async () => {
    // 00:00 today is inside the day: the half-open interval includes
    // its first instant.
    const id = uuidv7();
    await insertBooking({
      id,
      tenantId: tenant,
      locationId: loc,
      facility: extraFacilities[3]!,
      member: memberId,
      startsAt: wall(TODAY, "00:00"),
      endsAt: wall(TODAY, "01:00"),
    });
    const rows = await service.listBookingsForDay(ctx, { date: TODAY });
    expect(rows.map((row) => row.bookingId)).toContain(id);
  });

  it("excludes a booking that starts exactly when the day ends", async () => {
    // 00:00 TOMORROW is the day's exclusive upper bound: it is the
    // first instant of the next day, not of this one.
    const id = uuidv7();
    await insertBooking({
      id,
      tenantId: tenant,
      locationId: loc,
      facility: extraFacilities[3]!,
      member: memberId,
      startsAt: wall(TOMORROW, "00:00"),
      endsAt: wall(TOMORROW, "01:00"),
    });
    const rows = await service.listBookingsForDay(ctx, { date: TODAY });
    expect(rows.map((row) => row.bookingId)).not.toContain(id);
  });

  it("keeps the ordinary same-day booking", async () => {
    const id = uuidv7();
    await insertBooking({
      id,
      tenantId: tenant,
      locationId: loc,
      facility: extraFacilities[4]!,
      member: memberId,
      startsAt: wall(TODAY, "10:00"),
      endsAt: wall(TODAY, "11:00"),
    });
    const rows = await service.listBookingsForDay(ctx, { date: TODAY });
    expect(rows.map((row) => row.bookingId)).toContain(id);
  });

  it("keeps the facility filter and the location filter narrowing the read", async () => {
    const otherFacilityBooking = uuidv7();
    const sameSiteBooking = uuidv7();
    await insertBooking({
      id: otherFacilityBooking,
      tenantId: tenant,
      locationId: otherLoc,
      facility: otherFacilityId,
      member: memberId,
      startsAt: wall(TODAY, "10:00"),
      endsAt: wall(TODAY, "11:00"),
    });
    await insertBooking({
      id: sameSiteBooking,
      tenantId: tenant,
      locationId: loc,
      facility: facilityId,
      member: memberId,
      startsAt: wall(TODAY, "12:00"),
      endsAt: wall(TODAY, "13:00"),
    });
    const otherTenantBooking = uuidv7();
    await insertBooking({
      id: otherTenantBooking,
      tenantId: otherTenant,
      locationId: otherTenantLoc,
      facility: otherTenantFacility,
      member: null,
      walkInName: "Carry Guest",
      startsAt: wall(TODAY, "10:00"),
      endsAt: wall(TODAY, "11:00"),
    });

    // The facility filter still narrows the read to one facility.
    const filtered = await service.listBookingsForDay(ctx, {
      date: TODAY,
      facilityId,
    });
    expect(filtered.map((row) => row.bookingId)).not.toContain(
      otherFacilityBooking,
    );

    // Without the filter the same tenant's other facilities are
    // visible — that is the existing scope — but another tenant's
    // booking never is.
    const unfiltered = await service.listBookingsForDay(ctx, { date: TODAY });
    const ids = unfiltered.map((row) => row.bookingId);
    expect(ids).not.toContain(otherTenantBooking);
    expect(ids).toContain(otherFacilityBooking);

    // The location filter narrows the read to one site.
    const atOtherSite = await service.listBookingsForDay(ctx, {
      date: TODAY,
      locationId: otherLoc,
    });
    expect(atOtherSite.map((row) => row.bookingId)).toContain(
      otherFacilityBooking,
    );
    expect(atOtherSite.map((row) => row.bookingId)).not.toContain(
      sameSiteBooking,
    );
  });
  it("honours the caller's own locations when location scoping is on", async () => {
    // SUPPLEMENTARY scope regression (not a historical RED): the
    // predicate correction must not widen what a restricted caller may
    // read. A carry-over booking at the caller's own site is returned;
    // the same night at a site the caller may not reach is not.
    const allowed = uuidv7();
    const denied = uuidv7();
    await insertBooking({
      id: allowed,
      tenantId: scopedTenant,
      locationId: scopedLocA,
      facility: scopedFacilityA,
      member: scopedMemberId,
      startsAt: wall(YESTERDAY, "23:00"),
      endsAt: wall(TODAY, "00:30"),
    });
    await insertBooking({
      id: denied,
      tenantId: scopedTenant,
      locationId: scopedLocB,
      facility: scopedFacilityB,
      member: null,
      walkInName: "Scoped Guest",
      startsAt: wall(YESTERDAY, "23:00"),
      endsAt: wall(TODAY, "00:30"),
    });

    const rows = await service.listBookingsForDay(scopedCtx, { date: TODAY });
    const ids = rows.map((row) => row.bookingId);
    expect(ids).toContain(allowed);
    expect(ids).not.toContain(denied);
  });
});
