import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, asUserId } from "@/lib/ids";
import {
  addDays,
  todayInZone,
  weekdayOf,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";

// V-08 — utilisation. Written before lib/services/utilisation.ts
// exists: the first run is deliberately red.
//
// The fixture is a deliberately "almost full" facility: every hourly
// business-hours bucket over the last 4 weeks has a confirmed booking
// except Friday 3pm. The report must identify exactly that slot as
// the emptiest recurring one. A second act books the Friday 3pm slots
// then cancels them — cancellations must free the slot again (a
// cancelled booking is not utilisation). A tenant with no configured
// business hours gets the honest null, never invented availability.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const tenant2 = asTenantId(uuidv7());
const loc = uuidv7();
const loc2 = uuidv7();
const actor = asUserId(uuidv7());
const facilityId = uuidv7();
const facility2Id = uuidv7();

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };

let utilisation: typeof import("@/lib/services/utilisation");
let bookings: typeof import("@/lib/services/bookings");

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function businessHoursValue() {
  return {
    days: DAY_NAMES.map((day) => ({
      day,
      closed: false,
      open: "06:00",
      close: "22:00",
    })),
  };
}

function instant(dateIso: string, hour: number): Date {
  return zonedWallTimeToInstant(
    dateIso,
    `${String(hour).padStart(2, "0")}:00`,
    TZ,
  );
}

beforeAll(async () => {
  utilisation = await import("@/lib/services/utilisation");
  bookings = await import("@/lib/services/bookings");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Utilisation', 'active', $3), ($4, $5, 'Utilisation Bare', 'active', $3)",
    [tenant, `v08-${RUN}`, TZ, tenant2, `v08b-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Pool Site', true), ($3, $4, 'Bare Site', true)",
    [loc, tenant, loc2, tenant2],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9198${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values
       ($1, $2, $3, 'Full Pool', 'pool', 4),
       ($4, $5, $6, 'Bare Court', 'court', 1)`,
    [facilityId, tenant, loc, facility2Id, tenant2, loc2],
  );
  await admin.query(
    `insert into config_values (key, scope_type, scope_id, tenant_id, value)
     values ('operations.business_hours', 'tenant', $1, $2, $3::jsonb)`,
    [tenant, tenant, JSON.stringify(businessHoursValue())],
  );
  await admin.query(
    `insert into booking_price_rules (id, tenant_id, facility_id, label, days_of_week, start_time, end_time, price_paise, priority, is_active)
     values ($1, $2, null, 'Default', '{}', null, null, 10000, 0, true)`,
    [uuidv7(), tenant],
  );

  // 28 days (4 full weeks) ending today; 06:00–22:00 hourly buckets.
  const today = todayInZone(TZ);
  const values: string[] = [];
  const params: unknown[] = [tenant, loc, facilityId];
  let p = 4;
  for (let back = 27; back >= 0; back--) {
    const date = addDays(today, -back);
    for (let hour = 6; hour < 22; hour++) {
      if (weekdayOf(date) === 5 && hour === 15) continue;
      values.push(
        `($${p++}, $1, $2, $3, 'Fixture Guest', $${p++}, $${p++}, 'confirmed', 10000)`,
      );
      params.push(
        uuidv7(),
        instant(date, hour).toISOString(),
        instant(date, hour + 1).toISOString(),
      );
    }
  }
  await admin.query(
    `insert into bookings (id, tenant_id, location_id, facility_id, walk_in_name, starts_at, ends_at, status, price_paise) values ${values.join(", ")}`,
    params,
  );
}, 120_000);

afterAll(async () => {
  for (const t of [tenant, tenant2]) {
    await admin.query("delete from bookings where tenant_id = $1", [t]);
    await admin.query("delete from config_values where tenant_id = $1", [t]);
    await admin.query("delete from facilities where tenant_id = $1", [t]);
    await admin.query("delete from locations where tenant_id = $1", [t]);
    await admin.query("delete from tenants where id = $1", [t]);
  }
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

function fridaysInWindow(): string[] {
  const today = todayInZone(TZ);
  const fridays: string[] = [];
  for (let back = 27; back >= 0; back--) {
    const date = addDays(today, -back);
    if (weekdayOf(date) === 5) fridays.push(date);
  }
  return fridays;
}

describe("V-08 utilisation", () => {
  it("identifies the emptiest recurring slot from fixture bookings", async () => {
    const report = await utilisation.getFacilityUtilisation(ctx);
    expect(report.businessHoursConfigured).toBe(true);
    expect(report.fromDate < report.toDate).toBe(true);

    const facility = report.facilities.find((f) => f.facilityId === facilityId);
    expect(facility).toBeDefined();
    expect(facility!.bookedMinutes).toBe(444 * 60);
    expect(facility!.availableMinutes).toBe(28 * 16 * 60);
    expect(facility!.utilisationPct).toBe(99);

    expect(report.emptiest).toMatchObject({
      dayOfWeek: 5,
      hour: 15,
      bookedMinutes: 0,
      utilisationPct: 0,
    });

    const friday = report.byDay.find((d) => d.dayOfWeek === 5);
    expect(friday).toBeDefined();
    expect(friday!.bookedMinutes).toBe(15 * 60 * 4);
    expect(friday!.availableMinutes).toBe(16 * 60 * 4);
  });

  it("cancelled bookings are not utilisation — cancelling frees the slot again", async () => {
    const fridays = fridaysInWindow();
    expect(fridays).toHaveLength(4);

    const createdIds: string[] = [];
    for (const date of fridays) {
      const created = await bookings.createBooking(ctx, {
        facilityId,
        subUnitId: null,
        walkInName: "Friday Fill",
        startsAt: instant(date, 15).toISOString(),
        endsAt: instant(date, 16).toISOString(),
      });
      expect(created.ok).toBe(true);
      if (created.ok) createdIds.push(created.bookingId);
    }

    const full = await utilisation.getFacilityUtilisation(ctx);
    expect(full.emptiest?.hour).not.toBe(15);

    for (const id of createdIds) {
      const cancelled = await bookings.cancelBooking(ctx, id);
      expect(cancelled.ok).toBe(true);
    }

    const freed = await utilisation.getFacilityUtilisation(ctx);
    expect(freed.emptiest).toMatchObject({
      dayOfWeek: 5,
      hour: 15,
      bookedMinutes: 0,
      utilisationPct: 0,
    });
  });

  it("returns an honest null when business hours are not configured", async () => {
    const bare = await utilisation.getFacilityUtilisation({
      tenantId: tenant2,
      userId: actor,
      requestId: uuidv7(),
    });
    expect(bare.businessHoursConfigured).toBe(false);
    expect(bare.emptiest).toBeNull();
    const facility = bare.facilities.find((f) => f.facilityId === facility2Id);
    expect(facility).toBeDefined();
    expect(facility!.availableMinutes).toBe(0);
    expect(facility!.utilisationPct).toBeNull();
  });
});
