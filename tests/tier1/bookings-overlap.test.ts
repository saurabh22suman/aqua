import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";

// V-02 — bookings + overlap prevention. Written before the migration
// and lib/services/bookings.ts exist: the first run is deliberately
// red.
//
// The safety property under test is the database's, not the
// application's: the btree_gist EXCLUDE constraint makes "fifty
// concurrent identical booking attempts produce exactly one success"
// true. A check-then-insert would pass a single-threaded test and
// fail this one; the concurrent case is the point.
//
// Also pinned here: adjacent slots (an hour that starts exactly when
// the previous one ends) do not conflict — the constraint's range is
// half-open [start, end); a cancelled booking frees its slot; a
// cancelled/completed booking cannot be re-cancelled; and two tenants
// may book the same wall-clock slot (tenant_id leads the constraint).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const tenant2 = asTenantId(uuidv7());
const loc = uuidv7();
const loc2 = uuidv7();
const actor = asUserId(uuidv7());
const personId = uuidv7();
const memberId = asMemberId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };

let bookings: typeof import("@/lib/services/bookings");

const facilityId = uuidv7();
const facility2Id = uuidv7();
const awayFacilityId = uuidv7();
let laneAId = "";
let laneBId = "";

const PRICE = 50_000;

function hoursFromNow(hours: number): { startsAt: string; endsAt: string } {
  const start = new Date(Date.now() + hours * 3_600_000);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
  };
}

async function auditCount(action: string, entityId: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "select count(*)::text as n from audit_log where tenant_id = $1 and action = $2 and entity_id = $3",
    [tenant, action, entityId],
  );
  return Number(rows[0]?.n ?? "0");
}

beforeAll(async () => {
  bookings = await import("@/lib/services/bookings");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Overlap Test', 'active', $3), ($4, $5, 'Overlap Test 2', 'active', $3)",
    [tenant, `v02-${RUN}`, TZ, tenant2, `v02b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values ($1, $3, 'Pool Site', true), ($2, $4, 'Court Site', true)`,
    [loc, loc2, tenant, tenant2],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9195${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Overlap Member')",
    [personId, tenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenant, personId, loc, `V02-${RUN}`],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values
       ($1, $2, $3, 'Main Pool', 'pool', 4),
       ($4, $2, $3, 'Practice Pool', 'pool', 4)`,
    [facilityId, tenant, loc, facility2Id],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values ($1, $2, $3, 'Away Pool', 'pool', 4)`,
    [awayFacilityId, tenant2, loc2],
  );

  await admin.query(
    `insert into facility_sub_units (id, tenant_id, facility_id, name) values ($1, $2, $3, 'Lane 1'), ($4, $2, $3, 'Lane 2')`,
    [uuidv7(), tenant, facilityId, uuidv7()],
  );
  const lanes = await admin.query<{ id: string; name: string }>(
    "select id, name from facility_sub_units where tenant_id = $1 order by name",
    [tenant],
  );
  laneAId = lanes.rows.find((r) => r.name === "Lane 1")!.id;
  laneBId = lanes.rows.find((r) => r.name === "Lane 2")!.id;

  await admin.query(
    `insert into booking_price_rules (id, tenant_id, facility_id, label, days_of_week, start_time, end_time, price_paise, priority, is_active)
     values ($1, $2, null, 'Default', '{}', null, null, $3, 0, true),
            ($4, $5, null, 'Default', '{}', null, null, $3, 0, true)`,
    [uuidv7(), tenant, PRICE, uuidv7(), tenant2],
  );
}, 60_000);

afterAll(async () => {
  for (const t of [tenant, tenant2]) {
    await admin.query("delete from bookings where tenant_id = $1", [t]);
    await admin.query("delete from booking_price_rules where tenant_id = $1", [t]);
    await admin.query("delete from facility_sub_units where tenant_id = $1", [t]);
    await admin.query("delete from facilities where tenant_id = $1", [t]);
    await admin.query("delete from members where tenant_id = $1", [t]);
    await admin.query("delete from persons where tenant_id = $1", [t]);
    await admin.query("delete from locations where tenant_id = $1", [t]);
    await admin.query("delete from tenants where id = $1", [t]);
  }
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("V-02 bookings and overlap prevention", () => {
  it(
    "fifty concurrent identical booking attempts produce exactly one success",
    async () => {
      const slot = hoursFromNow(2);
      const input = {
        facilityId,
        subUnitId: laneAId,
        memberId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      };

      const results = await Promise.all(
        Array.from({ length: 50 }, () => bookings.createBooking(ctx, input)),
      );

      const successes = results.filter((r) => r.ok);
      const failures = results.filter((r) => !r.ok);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(49);
      for (const failure of failures) {
        if (failure.ok) continue;
        expect(failure.error).toBe(bookings.SLOT_TAKEN_ERROR);
      }

      const { rows } = await admin.query<{ n: string }>(
        "select count(*)::text as n from bookings where tenant_id = $1 and facility_id = $2 and status in ('held','confirmed')",
        [tenant, facilityId],
      );
      expect(Number(rows[0]?.n)).toBe(1);
    },
    60_000,
  );

  it("adjacent slots — one ends exactly when the next starts — both succeed", async () => {
    const first = hoursFromNow(5);
    const second = {
      startsAt: first.endsAt,
      endsAt: new Date(new Date(first.endsAt).getTime() + 3_600_000).toISOString(),
    };

    const a = await bookings.createBooking(ctx, {
      facilityId: facility2Id,
      subUnitId: null,
      memberId,
      ...first,
    });
    const b = await bookings.createBooking(ctx, {
      facilityId: facility2Id,
      subUnitId: null,
      memberId,
      ...second,
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("a cancelled booking frees its slot", async () => {
    const slot = hoursFromNow(8);
    const input = {
      facilityId,
      subUnitId: laneBId,
      memberId,
      ...slot,
    };

    const first = await bookings.createBooking(ctx, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const cancelled = await bookings.cancelBooking(ctx, first.bookingId);
    expect(cancelled.ok).toBe(true);

    const second = await bookings.createBooking(ctx, input);
    expect(second.ok).toBe(true);
    expect(second.ok && second.bookingId).not.toBe(first.bookingId);
  });

  it("writes booking.create and booking.cancel audit rows in-transaction", async () => {
    const slot = hoursFromNow(11);
    const created = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: null,
      walkInName: "Audit Walk-in",
      ...slot,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await auditCount("booking.create", created.bookingId)).toBe(1);

    const cancelled = await bookings.cancelBooking(ctx, created.bookingId);
    expect(cancelled.ok).toBe(true);
    expect(await auditCount("booking.cancel", created.bookingId)).toBe(1);
  });

  it("refuses to cancel a completed booking and an already-cancelled one", async () => {
    const slot = hoursFromNow(14);
    const created = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: null,
      walkInName: "Done Walk-in",
      ...slot,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await admin.query("update bookings set status = 'completed' where id = $1", [
      created.bookingId,
    ]);
    const refused = await bookings.cancelBooking(ctx, created.bookingId);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/completed/i);

    await admin.query("update bookings set status = 'confirmed' where id = $1", [
      created.bookingId,
    ]);
    const cancelled = await bookings.cancelBooking(ctx, created.bookingId);
    expect(cancelled.ok).toBe(true);
    const again = await bookings.cancelBooking(ctx, created.bookingId);
    expect(again.ok).toBe(false);
  });

  it("allows two tenants to book the same wall-clock slot (tenant isolation)", async () => {
    const slot = hoursFromNow(17);

    const mine = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: null,
      walkInName: "Tenant One",
      ...slot,
    });
    expect(mine.ok).toBe(true);

    const otherCtx = { tenantId: tenant2, userId: actor, requestId: uuidv7() };
    const theirs = await bookings.createBooking(otherCtx, {
      facilityId: awayFacilityId,
      subUnitId: null,
      walkInName: "Tenant Two",
      ...slot,
    });
    expect(theirs.ok).toBe(true);
  });

  it("lists bookings for a day, scoped to the tenant and facility", async () => {
    const rows = await bookings.listBookingsForDay(ctx, {
      date: new Date(Date.now() + 2 * 3_600_000)
        .toLocaleDateString("en-CA", { timeZone: TZ }),
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.bookingId).toBeTruthy();
      expect(["held", "confirmed", "cancelled", "completed"]).toContain(
        row.status,
      );
    }
  });
});
