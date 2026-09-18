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

// V-03 — slots and pricing. Written before booking_price_rules and
// the pricing resolver exist: the first run is deliberately red.
//
// Every rule here is a product rule the resolver must honour:
//   * a time-of-day rule matches only inside its window;
//   * an empty days_of_week matches every day, a non-empty one only
//     those days (0 = Sunday, matching JS / weekdayOf);
//   * a facility-specific rule beats the all-facilities default;
//   * the winner is highest priority first, then narrowest window;
//   * no matching rule is an honest refusal, never a silent zero;
//   * the advance-booking window (config, default 30 days) refuses
//     far-future bookings;
//   * booking creation snapshots the resolved price — a later rule
//     change never rewrites a booking already made.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const loc = uuidv7();
const actor = asUserId(uuidv7());
const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };

const facilityA = uuidv7();
const facilityB = uuidv7();

let bookings: typeof import("@/lib/services/bookings");

const DAY_MS = 86_400_000;

function wall(dateIso: string, time: string): string {
  return zonedWallTimeToInstant(dateIso, time, TZ).toISOString();
}

function dateForDow(target: number): string {
  let date = addDays(todayInZone(TZ), 1);
  for (let i = 0; i < 7; i++) {
    if (weekdayOf(date) === target) return date;
    date = addDays(date, 1);
  }
  throw new Error("unreachable");
}

const MONDAY = dateForDow(1);
const SATURDAY = dateForDow(6);

async function insertRule(input: {
  facilityId?: string | null;
  label: string;
  daysOfWeek?: number[];
  startTime?: string | null;
  endTime?: string | null;
  pricePaise: number;
  priority?: number;
  isActive?: boolean;
}): Promise<string> {
  const id = uuidv7();
  await admin.query(
    `insert into booking_price_rules
       (id, tenant_id, facility_id, label, days_of_week, start_time, end_time, price_paise, priority, is_active)
     values ($1, $2, $3, $4, $5::int[], $6, $7, $8, $9, $10)`,
    [
      id,
      tenant,
      input.facilityId ?? null,
      input.label,
      input.daysOfWeek ?? [],
      input.startTime ?? null,
      input.endTime ?? null,
      input.pricePaise,
      input.priority ?? 0,
      input.isActive ?? true,
    ],
  );
  return id;
}

beforeAll(async () => {
  bookings = await import("@/lib/services/bookings");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Pricing Test', 'active', $3)",
    [tenant, `v03-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Pricing Site', true)",
    [loc, tenant],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9196${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values
       ($1, $2, $3, 'Court A', 'court', 2),
       ($4, $2, $3, 'Court B', 'court', 2)`,
    [facilityA, tenant, loc, facilityB],
  );
}, 60_000);

afterAll(async () => {
  await admin.query("delete from bookings where tenant_id = $1", [tenant]);
  await admin.query("delete from booking_price_rules where tenant_id = $1", [
    tenant,
  ]);
  await admin.query("delete from config_values where tenant_id = $1", [tenant]);
  await admin.query("delete from facilities where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("V-03 booking pricing", () => {
  it("applies a time-of-day rule only inside its window, and the all-day rule otherwise", async () => {
    await insertRule({
      label: "Peak",
      startTime: "17:00",
      endTime: "22:00",
      pricePaise: 90_000,
      priority: 0,
    });
    await insertRule({
      label: "Default",
      pricePaise: 40_000,
      priority: -1,
    });

    const morning = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "09:00"),
      endsAt: wall(MONDAY, "10:00"),
    });
    expect(morning).toMatchObject({ ok: true, pricePaise: 40_000 });

    const evening = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "18:00"),
      endsAt: wall(MONDAY, "19:00"),
    });
    expect(evening).toMatchObject({ ok: true, pricePaise: 90_000 });
  });

  it("honours a day-of-week rule on its days and falls through on others", async () => {
    await insertRule({
      label: "Weekend",
      daysOfWeek: [0, 6],
      pricePaise: 100_000,
      priority: 5,
    });

    const saturday = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(SATURDAY, "10:00"),
      endsAt: wall(SATURDAY, "11:00"),
    });
    expect(saturday).toMatchObject({ ok: true, pricePaise: 100_000 });

    const monday = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "10:00"),
      endsAt: wall(MONDAY, "11:00"),
    });
    expect(monday).toMatchObject({ ok: true, pricePaise: 40_000 });
  });

  it("a facility-specific rule beats the all-facilities default", async () => {
    await admin.query("delete from booking_price_rules where tenant_id = $1", [
      tenant,
    ]);
    await insertRule({ label: "Default", pricePaise: 40_000, priority: 0 });
    await insertRule({
      facilityId: facilityA,
      label: "Court A rate",
      pricePaise: 60_000,
      priority: 0,
    });

    const a = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "10:00"),
      endsAt: wall(MONDAY, "11:00"),
    });
    expect(a).toMatchObject({ ok: true, pricePaise: 60_000 });

    const b = await bookings.quoteBooking(ctx, {
      facilityId: facilityB,
      startsAt: wall(MONDAY, "10:00"),
      endsAt: wall(MONDAY, "11:00"),
    });
    expect(b).toMatchObject({ ok: true, pricePaise: 40_000 });
  });

  it("picks highest priority first, then the narrowest matching window", async () => {
    await admin.query("delete from booking_price_rules where tenant_id = $1", [
      tenant,
    ]);
    await insertRule({
      label: "Broad",
      startTime: "09:00",
      endTime: "17:00",
      pricePaise: 30_000,
      priority: 1,
    });
    await insertRule({
      label: "Narrow",
      startTime: "09:00",
      endTime: "12:00",
      pricePaise: 25_000,
      priority: 1,
    });

    const narrowWins = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "10:00"),
      endsAt: wall(MONDAY, "11:00"),
    });
    expect(narrowWins).toMatchObject({ ok: true, pricePaise: 25_000 });

    await insertRule({
      label: "Priority wins",
      startTime: "09:00",
      endTime: "17:00",
      pricePaise: 35_000,
      priority: 2,
    });
    const priorityWins = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "10:00"),
      endsAt: wall(MONDAY, "11:00"),
    });
    expect(priorityWins).toMatchObject({ ok: true, pricePaise: 35_000 });
  });

  it("refuses honestly when no active rule matches", async () => {
    await admin.query("delete from booking_price_rules where tenant_id = $1", [
      tenant,
    ]);
    await insertRule({
      label: "Evening only",
      startTime: "17:00",
      endTime: "22:00",
      pricePaise: 50_000,
    });

    const result = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "10:00"),
      endsAt: wall(MONDAY, "11:00"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/price/i);
  });

  it("refuses bookings beyond the 30-day advance window and permits ones inside it", async () => {
    await admin.query("delete from booking_price_rules where tenant_id = $1", [
      tenant,
    ]);
    await insertRule({ label: "Default", pricePaise: 40_000 });

    const inWindow = new Date(Date.now() + 29 * DAY_MS);
    const tooFar = new Date(Date.now() + 31 * DAY_MS);

    const allowed = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: inWindow.toISOString(),
      endsAt: new Date(inWindow.getTime() + 3_600_000).toISOString(),
    });
    expect(allowed.ok).toBe(true);

    const refused = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: tooFar.toISOString(),
      endsAt: new Date(tooFar.getTime() + 3_600_000).toISOString(),
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("30 days");
  });

  it("honours a tenant override of the advance window", async () => {
    await admin.query(
      `insert into config_values (key, scope_type, scope_id, tenant_id, value)
       values ('bookings.advance_window_days', 'tenant', $1, $2, '7'::jsonb)`,
      [tenant, tenant],
    );

    const inside = new Date(Date.now() + 6 * DAY_MS);
    const outside = new Date(Date.now() + 8 * DAY_MS);

    const allowed = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: inside.toISOString(),
      endsAt: new Date(inside.getTime() + 3_600_000).toISOString(),
    });
    expect(allowed.ok).toBe(true);

    const refused = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: outside.toISOString(),
      endsAt: new Date(outside.getTime() + 3_600_000).toISOString(),
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("7 days");
  });

  it("snapshots the resolved price onto the booking; later rule changes do not rewrite it", async () => {
    await admin.query("delete from booking_price_rules where tenant_id = $1", [
      tenant,
    ]);
    await insertRule({ label: "Default", pricePaise: 40_000 });

    const created = await bookings.createBooking(ctx, {
      facilityId: facilityA,
      subUnitId: null,
      walkInName: "Snapshot Guest",
      startsAt: wall(MONDAY, "14:00"),
      endsAt: wall(MONDAY, "15:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.pricePaise).toBe(40_000);

    const stored = await admin.query<{ price_paise: string }>(
      "select price_paise from bookings where id = $1",
      [created.bookingId],
    );
    expect(Number(stored.rows[0]!.price_paise)).toBe(40_000);

    await insertRule({ label: "New default", pricePaise: 99_000, priority: 9 });

    const after = await admin.query<{ price_paise: string }>(
      "select price_paise from bookings where id = $1",
      [created.bookingId],
    );
    expect(Number(after.rows[0]!.price_paise)).toBe(40_000);
  });
});
