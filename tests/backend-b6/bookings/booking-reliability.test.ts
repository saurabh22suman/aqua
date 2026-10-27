import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
//
// The privileged pool is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only — seeding the tenants/locations/facilities/members the
// tables under FORCE RLS hide from the application pool. Every
// assertion in this file still runs against the application's own
// services, which connect as `app_login` under tenant RLS. The
// credential is named in exactly one place; this file never names it.
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone, zonedWallTimeToInstant } from "@/lib/time/tz";

// Batch 6 (hardening) — regression re-check of the booking workflow
// that was delivered: exclusivity, duplicate/retry, roles, isolation
// and cancel/release.
//
// This file does not add behaviour — it pins what the workflow already
// guarantees, so a later change cannot quietly weaken it:
//
//   * exactly one of two concurrent requests for a slot wins, and the
//     loser leaves NO booking row and NO audit row behind;
//   * a retry of a create never produces a second booking;
//   * a retry of "request bill" returns the SAME invoice;
//   * cancelling frees the slot, keeps the row as history, and cannot
//     be done twice;
//   * a booking cannot be cancelled by another tenant or by a caller
//     who cannot reach its location.
//
// It also CHARACTERISES one known gap in the exclusion constraint's
// granularity (whole-facility vs sub-unit) so the coordinator has
// executable evidence of it rather than a description.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const otherTenant = asTenantId(uuidv7());
const scopedTenant = asTenantId(uuidv7());

const loc = uuidv7();
const otherLoc = uuidv7();
const facilityId = uuidv7();
const otherFacilityId = uuidv7();
const laneA = uuidv7();
const laneB = uuidv7();

const scopedLocA = uuidv7();
const scopedLocB = uuidv7();
const scopedFacilityA = uuidv7();
const scopedFacilityB = uuidv7();

const actor = asUserId(uuidv7());
const otherActor = asUserId(uuidv7());
const personId = uuidv7();
const memberId = asMemberId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };
const otherCtx = {
  tenantId: otherTenant,
  userId: otherActor,
  requestId: uuidv7(),
};
const scopedCtx = {
  tenantId: scopedTenant,
  userId: actor,
  requestId: uuidv7(),
  allLocations: false,
  locationIds: [scopedLocA],
};

let bookings: typeof import("@/lib/services/bookings");
let billing: typeof import("@/lib/services/booking-billing");
let priceAdmin: typeof import("@/lib/services/booking-price-admin");

function wall(dateIso: string, time: string): string {
  return zonedWallTimeToInstant(dateIso, time, TZ).toISOString();
}

const DAY_1 = addDays(todayInZone(TZ), 1);
const DAY_2 = addDays(todayInZone(TZ), 2);
const DAY_3 = addDays(todayInZone(TZ), 3);
const DAY_4 = addDays(todayInZone(TZ), 4);
const DAY_5 = addDays(todayInZone(TZ), 5);

async function bookingRows(tenantId: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "select count(*)::text as n from bookings where tenant_id = $1",
    [tenantId],
  );
  return Number(rows[0]?.n);
}

async function cancelAuditCount(tenantId: string, bookingId: string) {
  const { rows } = await admin.query<{ n: string }>(
    "select count(*)::text as n from audit_log where tenant_id = $1 and action = 'booking.cancel' and entity_id = $2",
    [tenantId, bookingId],
  );
  return Number(rows[0]?.n);
}

async function createAuditCount(tenantId: string, bookingId: string) {
  const { rows } = await admin.query<{ n: string }>(
    "select count(*)::text as n from audit_log where tenant_id = $1 and action = 'booking.create' and entity_id = $2",
    [tenantId, bookingId],
  );
  return Number(rows[0]?.n);
}

beforeAll(async () => {
  bookings = await import("@/lib/services/bookings");
  billing = await import("@/lib/services/booking-billing");
  priceAdmin = await import("@/lib/services/booking-price-admin");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $3, 'Rel A', 'active', $6),
       ($2, $4, 'Rel B', 'active', $6),
       ($5, $7, 'Rel Scoped', 'active', $6)`,
    [
      tenant,
      otherTenant,
      `b6-rel-a-${RUN}`,
      `b6-rel-b-${RUN}`,
      scopedTenant,
      TZ,
      `b6-rel-c-${RUN}`,
    ],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Rel Site', true),
       ($2, $3, 'Rel Other Site', false),
       ($4, $5, 'Scoped A', true),
       ($6, $5, 'Scoped B', false)`,
    [loc, otherLoc, tenant, scopedLocA, scopedTenant, scopedLocB],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values
       ($1, $3, $4, 'Rel Court', 'court', 4),
       ($2, $3, $5, 'Rel Court Two', 'court', 4),
       ($6, $7, $8, 'Scoped Court A', 'court', 2),
       ($9, $7, $10, 'Scoped Court B', 'court', 2)`,
    [
      facilityId,
      otherFacilityId,
      tenant,
      loc,
      otherLoc,
      scopedFacilityA,
      scopedTenant,
      scopedLocA,
      scopedFacilityB,
      scopedLocB,
    ],
  );
  await admin.query(
    "insert into facility_sub_units (id, tenant_id, facility_id, name) values ($1, $3, $4, 'Lane A'), ($2, $3, $4, 'Lane B')",
    [laneA, laneB, tenant, facilityId],
  );
  await admin.query(
    "insert into users (id, phone) values ($1, $2), ($3, $4)",
    [
      actor,
      `+9197${String(Date.now()).slice(-8)}`,
      otherActor,
      `+9196${String(Date.now()).slice(-8)}`,
    ],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Rel Member')",
    [personId, tenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenant, personId, loc, `REL-${RUN}`],
  );

  await priceAdmin.saveBookingPriceRule(ctx, {
    label: "Rel rate",
    facilityId,
    pricePaise: 20_000,
  });
  await priceAdmin.saveBookingPriceRule(
    {
      tenantId: scopedTenant,
      userId: actor,
      requestId: uuidv7(),
      allLocations: true,
      locationIds: [] as string[],
    },
    { label: "Scoped rate", pricePaise: 20_000 },
  );

  // Location scoping ON for the scoped tenant: the restricted context
  // may only reach Scoped A.
  await admin.query(
    `insert into config_values (key, scope_type, scope_id, tenant_id, value)
     values ('access.location_scoped_staff', 'tenant', $1, $2, 'true'::jsonb)
     on conflict do nothing`,
    [scopedTenant, scopedTenant],
  );
}, 60_000);

afterAll(async () => {
  for (const id of [tenant, otherTenant, scopedTenant]) {
    await admin.query("delete from payments where tenant_id = $1", [id]);
    await admin.query("delete from invoice_line_items where tenant_id = $1", [id]);
    await admin.query("delete from bookings where tenant_id = $1", [id]);
    await admin.query("delete from invoices where tenant_id = $1", [id]);
    await admin.query("delete from booking_price_rules where tenant_id = $1", [id]);
    await admin.query("delete from config_values where tenant_id = $1", [id]);
    await admin.query("delete from facility_sub_units where tenant_id = $1", [id]);
    await admin.query("delete from facilities where tenant_id = $1", [id]);
    await admin.query("delete from members where tenant_id = $1", [id]);
    await admin.query("delete from locations where tenant_id = $1", [id]);
    await admin.query("delete from persons where tenant_id = $1", [id]);
    await admin.query("delete from tenants where id = $1", [id]);
  }
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("B6 booking reliability — exclusive slots", () => {
  it("lets exactly one of two concurrent requests for a slot win, with nothing left behind by the loser", async () => {
    const before = await bookingRows(tenant);

    const first = bookings.createBooking(ctx, {
      facilityId,
      memberId,
      startsAt: wall(DAY_1, "08:00"),
      endsAt: wall(DAY_1, "09:00"),
    });
    const second = bookings.createBooking(ctx, {
      facilityId,
      memberId,
      startsAt: wall(DAY_1, "08:00"),
      endsAt: wall(DAY_1, "09:00"),
    });
    const [a, b] = await Promise.all([first, second]);

    expect([a, b].filter((result) => result.ok)).toHaveLength(1);
    const refused = a.ok ? b : a;
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toBe(bookings.SLOT_TAKEN_ERROR);

    // Exactly one row, and exactly one audit row for it.
    expect(await bookingRows(tenant)).toBe(before + 1);
    const winner = a.ok ? a : b;
    if (!winner.ok) return;
    expect(await createAuditCount(tenant, winner.bookingId)).toBe(1);
  });

  it("refuses a second booking on the same lane", async () => {
    const first = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: laneA,
      memberId,
      startsAt: wall(DAY_2, "10:00"),
      endsAt: wall(DAY_2, "11:00"),
    });
    expect(first.ok).toBe(true);

    const second = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: laneA,
      memberId,
      startsAt: wall(DAY_2, "10:00"),
      endsAt: wall(DAY_2, "11:00"),
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe(bookings.SLOT_TAKEN_ERROR);
  });

  it("allows the same time on two different lanes", async () => {
    const first = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: laneA,
      memberId,
      startsAt: wall(DAY_3, "12:00"),
      endsAt: wall(DAY_3, "13:00"),
    });
    expect(first.ok).toBe(true);

    const second = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: laneB,
      memberId,
      startsAt: wall(DAY_3, "12:00"),
      endsAt: wall(DAY_3, "13:00"),
    });
    expect(second.ok).toBe(true);
  });

  it("CHARACTERISES a known gap: a whole-facility booking and a lane booking do not collide", async () => {
    // The exclusion constraint keys on
    // `coalesce(sub_unit_id, nil-uuid)`, so "the whole facility" and
    // "lane A" are DIFFERENT keys and both rows are accepted. This is
    // the constraint's granularity — a schema decision, not an
    // application bug — and it is recorded for the coordinator rather
    // than fixed here (no schema expansion in this batch, and the
    // insert exclusion stays the sole authority on concurrency).
    const whole = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: null,
      walkInName: "Whole Facility Guest",
      startsAt: wall(DAY_4, "15:00"),
      endsAt: wall(DAY_4, "16:00"),
    });
    expect(whole.ok).toBe(true);

    const lane = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: laneA,
      memberId,
      startsAt: wall(DAY_4, "15:00"),
      endsAt: wall(DAY_4, "16:00"),
    });
    expect(lane.ok).toBe(true);
  });
});

describe("B6 booking reliability — duplicate and retry", () => {
  it("never lets a retried create produce a second booking", async () => {
    const before = await bookingRows(tenant);
    const first = await bookings.createBooking(ctx, {
      facilityId,
      memberId,
      startsAt: wall(DAY_5, "09:00"),
      endsAt: wall(DAY_5, "10:00"),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // The client retries because the first response never arrived.
    const retry = await bookings.createBooking(ctx, {
      facilityId,
      memberId,
      startsAt: wall(DAY_5, "09:00"),
      endsAt: wall(DAY_5, "10:00"),
    });
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.error).toBe(bookings.SLOT_TAKEN_ERROR);

    // One row, one audit row — the retry changed nothing.
    expect(await bookingRows(tenant)).toBe(before + 1);
    expect(await createAuditCount(tenant, first.bookingId)).toBe(1);
  });

  it("returns the SAME invoice when the bill is requested twice", async () => {
    const created = await bookings.createBooking(ctx, {
      facilityId,
      memberId,
      startsAt: wall(DAY_5, "11:00"),
      endsAt: wall(DAY_5, "12:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await billing.requestBookingBill(ctx, created.bookingId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.alreadyBilled).toBe(false);

    const second = await billing.requestBookingBill(ctx, created.bookingId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyBilled).toBe(true);
    expect(second.bill.invoiceId).toBe(first.bill.invoiceId);

    const { rows } = await admin.query<{ n: string }>(
      "select count(*)::text as n from invoices where tenant_id = $1",
      [tenant],
    );
    // Only the one invoice this test raised.
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe("B6 booking reliability — cancel and release", () => {
  it("frees the slot on cancel, keeps the row as history, and cannot be cancelled twice", async () => {
    const created = await bookings.createBooking(ctx, {
      facilityId,
      memberId,
      startsAt: wall(DAY_2, "14:00"),
      endsAt: wall(DAY_2, "15:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cancelled = await bookings.cancelBooking(ctx, created.bookingId);
    expect(cancelled.ok).toBe(true);
    expect(await cancelAuditCount(tenant, created.bookingId)).toBe(1);

    // The row stays — a cancelled booking is history, not a deletion.
    const board = await bookings.listBookingsForDay(ctx, {
      date: DAY_2,
      facilityId,
    });
    const row = board.find((entry) => entry.bookingId === created.bookingId);
    expect(row?.status).toBe("cancelled");

    // A second cancel is refused and writes no second audit row.
    const again = await bookings.cancelBooking(ctx, created.bookingId);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toMatch(/already cancelled/i);
    expect(await cancelAuditCount(tenant, created.bookingId)).toBe(1);

    // The slot is free again.
    const rebooked = await bookings.createBooking(ctx, {
      facilityId,
      memberId,
      startsAt: wall(DAY_2, "14:00"),
      endsAt: wall(DAY_2, "15:00"),
    });
    expect(rebooked.ok).toBe(true);
  });

  it("refuses to cancel another tenant's booking and writes no audit row", async () => {
    const created = await bookings.createBooking(ctx, {
      facilityId,
      memberId,
      startsAt: wall(DAY_3, "16:00"),
      endsAt: wall(DAY_3, "17:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const attempt = await bookings.cancelBooking(otherCtx, created.bookingId);
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toMatch(/not found/i);

    expect(await cancelAuditCount(tenant, created.bookingId)).toBe(0);
    const still = await admin.query<{ status: string }>(
      "select status from bookings where id = $1",
      [created.bookingId],
    );
    expect(still.rows[0]?.status).toBe("confirmed");
  });

  it("refuses to cancel a booking at a location the caller cannot reach", async () => {
    const created = await bookings.createBooking(
      {
        tenantId: scopedTenant,
        userId: actor,
        requestId: uuidv7(),
        allLocations: true,
        locationIds: [] as string[],
      },
      {
        facilityId: scopedFacilityB,
        walkInName: "Far Guest",
        startsAt: wall(DAY_3, "17:00"),
        endsAt: wall(DAY_3, "18:00"),
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const attempt = await bookings.cancelBooking(scopedCtx, created.bookingId);
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toMatch(/not found/i);

    const still = await admin.query<{ status: string }>(
      "select status from bookings where id = $1",
      [created.bookingId],
    );
    expect(still.rows[0]?.status).toBe("confirmed");
  });
});
