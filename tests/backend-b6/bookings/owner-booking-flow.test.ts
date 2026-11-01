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
import { asTenantId, asUserId } from "@/lib/ids";
import {
  addDays,
  todayInZone,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";

// Batch 6 — the owner booking flow, end to end on disposable data.
//
// The journey the owner actually takes, and the refusals that must
// hold while they take it:
//
//   no price configured → the quote refuses honestly (the dead end the
//   reception counter was hidden for) → a price is configured → the
//   quote resolves it → the booking is taken at that price → it shows
//   on the day board → it can be cancelled → the slot is free again.
//
// And the guarantees around it:
//   * two concurrent requests for the same slot: exactly one succeeds
//     (the database's exclusion constraint decides, not a read);
//   * back-to-back slots do not conflict (the range is half-open);
//   * a cancelled booking releases its slot;
//   * another tenant can neither read nor book these facilities;
//   * a location-scoped caller cannot reach another site's facility;
//   * an invalid date, time or period is refused;
//   * the money is the configured price, to the paisa.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const otherTenant = asTenantId(uuidv7());
const scopedTenant = asTenantId(uuidv7());

const locA = uuidv7();
const locB = uuidv7();
const facilityA = uuidv7();
const facilityB = uuidv7();

const scopedLocA = uuidv7();
const scopedLocB = uuidv7();
const scopedFacilityA = uuidv7();
const scopedFacilityB = uuidv7();

const actor = asUserId(uuidv7());
const otherActor = asUserId(uuidv7());
const personId = uuidv7();
const memberId = uuidv7();

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

const PRICE = 45_000;

let bookings: typeof import("@/lib/services/bookings");
let priceAdmin: typeof import("@/lib/services/booking-price-admin");
let billing: typeof import("@/lib/services/booking-billing");

function wall(dateIso: string, time: string): string {
  return zonedWallTimeToInstant(dateIso, time, TZ).toISOString();
}

const TOMORROW = addDays(todayInZone(TZ), 1);
const DAY_AFTER = addDays(todayInZone(TZ), 2);

beforeAll(async () => {
  bookings = await import("@/lib/services/bookings");
  priceAdmin = await import("@/lib/services/booking-price-admin");
  billing = await import("@/lib/services/booking-billing");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $3, 'Flow A', 'active', $6),
       ($2, $4, 'Flow B', 'active', $6),
       ($5, $7, 'Flow Scoped', 'active', $6)`,
    [
      tenant,
      otherTenant,
      `b6-flow-a-${RUN}`,
      `b6-flow-b-${RUN}`,
      scopedTenant,
      TZ,
      `b6-flow-c-${RUN}`,
    ],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Site A', true),
       ($2, $3, 'Site B', false),
       ($4, $5, 'Scoped A', true),
       ($6, $5, 'Scoped B', false)`,
    [locA, locB, tenant, scopedLocA, scopedTenant, scopedLocB],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values
       ($1, $3, $4, 'Court A', 'court', 2),
       ($2, $3, $5, 'Court B', 'court', 2),
       ($6, $7, $8, 'Scoped Court A', 'court', 2),
       ($9, $7, $10, 'Scoped Court B', 'court', 2)`,
    [
      facilityA,
      facilityB,
      tenant,
      locA,
      locB,
      scopedFacilityA,
      scopedTenant,
      scopedLocA,
      scopedFacilityB,
      scopedLocB,
    ],
  );
  await admin.query(
    "insert into users (id, phone) values ($1, $2), ($3, $4)",
    [
      actor,
      `+9192${String(Date.now()).slice(-8)}`,
      otherActor,
      `+9193${String(Date.now()).slice(-8)}`,
    ],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Flow Member')",
    [personId, tenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenant, personId, locA, `B6-${RUN}`],
  );
}, 60_000);

// F06 — the module gate is ENTITLEMENT-based, and these fixtures create
// tenants with no plan and no explicit feature. Their positive cases (the
// order/booking → invoice bridge) need the grant; no assertion changes.
beforeAll(async () => {
  const ids = [tenant, otherTenant, scopedTenant];
  await admin.query(
    "delete from tenant_features where tenant_id = any($1::uuid[])",
    [ids],
  );
  await admin.query(
    `insert into tenant_features (tenant_id, feature_key, enabled)
     select id, 'pool.booking', true from unnest($1::uuid[]) as id
     on conflict (tenant_id, feature_key) do update set enabled = true`,
    [ids],
  );
});

afterAll(async () => {
  for (const id of [tenant, otherTenant, scopedTenant]) {
    await admin.query("delete from payments where tenant_id = $1", [id]);
    await admin.query("delete from invoice_line_items where tenant_id = $1", [id]);
    await admin.query("delete from bookings where tenant_id = $1", [id]);
    await admin.query("delete from invoices where tenant_id = $1", [id]);
    await admin.query("delete from booking_price_rules where tenant_id = $1", [id]);
    await admin.query("delete from config_values where tenant_id = $1", [id]);
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

describe("B6 owner booking flow", () => {
  it("refuses honestly while no price is configured", async () => {
    await admin.query("delete from booking_price_rules where tenant_id = $1", [
      tenant,
    ]);

    const quote = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(TOMORROW, "08:00"),
    });
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.error).toMatch(/price/i);

    const created = await bookings.createBooking(ctx, {
      facilityId: facilityA,
      memberId,
      startsAt: wall(TOMORROW, "08:00"),
      endsAt: wall(TOMORROW, "09:00"),
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error).toMatch(/price/i);
  });

  it("configures a price, quotes it, books it, lists it and cancels it", async () => {
    const saved = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Standard rate",
      facilityId: facilityA,
      pricePaise: PRICE,
    });
    expect(saved.ok).toBe(true);

    const quote = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(TOMORROW, "08:00"),
    });
    expect(quote).toMatchObject({ ok: true, pricePaise: PRICE });

    const created = await bookings.createBooking(ctx, {
      facilityId: facilityA,
      memberId,
      startsAt: wall(TOMORROW, "08:00"),
      endsAt: wall(TOMORROW, "09:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.pricePaise).toBe(PRICE);

    // The price is stored as integer paise, never a float.
    const stored = await admin.query<{ price_paise: string }>(
      "select price_paise from bookings where id = $1",
      [created.bookingId],
    );
    expect(stored.rows[0]?.price_paise).toBe(String(PRICE));

    // The day board lists it.
    const board = await bookings.listBookingsForDay(ctx, {
      date: TOMORROW,
      facilityId: facilityA,
    });
    const row = board.find((entry) => entry.bookingId === created.bookingId);
    expect(row).toBeTruthy();
    expect(row?.pricePaise).toBe(PRICE);
    expect(row?.status).toBe("confirmed");

    // The bill is exactly the configured price, to the paisa.
    const billed = await billing.requestBookingBill(ctx, created.bookingId);
    expect(billed.ok).toBe(true);
    if (!billed.ok) return;
    expect(billed.bill.totalPaise).toBe(PRICE);
    expect(billed.bill.amountDuePaise).toBe(PRICE);

    // Cancelling releases the slot: the same slot can be booked again.
    const cancelled = await bookings.cancelBooking(ctx, created.bookingId);
    expect(cancelled.ok).toBe(true);

    const again = await bookings.createBooking(ctx, {
      facilityId: facilityA,
      memberId,
      startsAt: wall(TOMORROW, "08:00"),
      endsAt: wall(TOMORROW, "09:00"),
    });
    expect(again.ok).toBe(true);

    const audit = await admin.query<{ n: string }>(
      "select count(*)::text as n from audit_log where tenant_id = $1 and action = 'booking.cancel' and entity_id = $2",
      [tenant, created.bookingId],
    );
    expect(Number(audit.rows[0]?.n)).toBe(1);
  });

  it("records a walk-in but refuses to bill it", async () => {
    const created = await bookings.createBooking(ctx, {
      facilityId: facilityA,
      walkInName: "Walk-in Guest",
      startsAt: wall(TOMORROW, "11:00"),
      endsAt: wall(TOMORROW, "12:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const billed = await billing.requestBookingBill(ctx, created.bookingId);
    expect(billed.ok).toBe(false);
    if (billed.ok) return;
    expect(billed.error).toMatch(/member/i);
  });

  it("lets exactly one of two concurrent requests for the same slot win", async () => {
    const first = bookings.createBooking(ctx, {
      facilityId: facilityA,
      memberId,
      startsAt: wall(DAY_AFTER, "08:00"),
      endsAt: wall(DAY_AFTER, "09:00"),
    });
    const second = bookings.createBooking(ctx, {
      facilityId: facilityA,
      memberId,
      startsAt: wall(DAY_AFTER, "08:00"),
      endsAt: wall(DAY_AFTER, "09:00"),
    });
    const [a, b] = await Promise.all([first, second]);

    const outcomes = [a, b].map((result) => result.ok);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const refused = outcomes[0] ? b : a;
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatch(/taken/i);
  });

  it("allows back-to-back slots in the same day", async () => {
    const first = await bookings.createBooking(ctx, {
      facilityId: facilityA,
      memberId,
      startsAt: wall(TOMORROW, "14:00"),
      endsAt: wall(TOMORROW, "15:00"),
    });
    expect(first.ok).toBe(true);

    const second = await bookings.createBooking(ctx, {
      facilityId: facilityA,
      memberId,
      startsAt: wall(TOMORROW, "15:00"),
      endsAt: wall(TOMORROW, "16:00"),
    });
    expect(second.ok).toBe(true);
  });

  it("refuses an invalid date, time or period", async () => {
    const backwards = await bookings.createBooking(ctx, {
      facilityId: facilityA,
      memberId,
      startsAt: wall(TOMORROW, "10:00"),
      endsAt: wall(TOMORROW, "09:00"),
    });
    expect(backwards.ok).toBe(false);

    const both = await bookings.createBooking(ctx, {
      facilityId: facilityA,
      memberId,
      walkInName: "Both",
      startsAt: wall(TOMORROW, "17:00"),
      endsAt: wall(TOMORROW, "18:00"),
    });
    expect(both.ok).toBe(false);

    const neither = await bookings.createBooking(ctx, {
      facilityId: facilityA,
      memberId,
      walkInName: "Neither",
      startsAt: wall(TOMORROW, "18:00"),
      endsAt: wall(TOMORROW, "19:00"),
    });
    expect(neither.ok).toBe(false);
  });

  it("refuses to book another tenant's facility", async () => {
    const created = await bookings.createBooking(otherCtx, {
      facilityId: facilityA,
      memberId,
      startsAt: wall(TOMORROW, "20:00"),
      endsAt: wall(TOMORROW, "21:00"),
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error).toMatch(/facility/i);

    const facilities = await bookings.listBookableFacilities(otherCtx);
    expect(facilities).toHaveLength(0);
  });

  it("keeps a location-scoped caller inside its own site", async () => {
    await admin.query("delete from booking_price_rules where tenant_id = $1", [
      scopedTenant,
    ]);
    await admin.query(
      `insert into config_values (key, scope_type, scope_id, tenant_id, value)
       values ('access.location_scoped_staff', 'tenant', $1, $2, 'true'::jsonb)
       on conflict do nothing`,
      [scopedTenant, scopedTenant],
    );
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

    const inside = await bookings.createBooking(scopedCtx, {
      facilityId: scopedFacilityA,
      walkInName: "Scoped Guest",
      startsAt: wall(TOMORROW, "09:00"),
      endsAt: wall(TOMORROW, "10:00"),
    });
    expect(inside.ok).toBe(true);

    const outside = await bookings.createBooking(scopedCtx, {
      facilityId: scopedFacilityB,
      walkInName: "Scoped Guest",
      startsAt: wall(TOMORROW, "09:00"),
      endsAt: wall(TOMORROW, "10:00"),
    });
    expect(outside.ok).toBe(false);
    if (outside.ok) return;
    expect(outside.error).toMatch(/facility/i);
  });
});
