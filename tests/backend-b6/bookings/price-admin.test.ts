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

// Batch 6 — owner-authorized booking price configuration.
//
// This is the missing half of the V-03 price resolver: nothing in the
// tree could WRITE booking_price_rules, so every slot a club offered
// resolved to "No price is configured for this slot." The rules this
// file pins are the product rules, not implementation details:
//
//   * a saved rule becomes the price the resolver quotes — the
//     configured number and the quoted number are the same number;
//   * the price is stored as integer paise (bigint), never a float;
//   * an invalid window (end not after start) and a half window (one
//     time without the other) are refused — a rule that can never
//     match is a configuration mistake, not a silent dead price;
//   * overlapping rules are ALLOWED: the resolver already owns the
//     precedence (priority → facility-specific → narrowest window →
//     narrower day set), so the admin must not invent a second,
//     conflicting policy;
//   * a deactivated rule stops resolving;
//   * another tenant's rules are neither listed nor editable;
//   * the audit row is written in the same transaction as the rule;
//   * a location-scoped caller cannot price a facility outside its
//     own locations.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
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

let priceAdmin: typeof import("@/lib/services/booking-price-admin");
let bookings: typeof import("@/lib/services/bookings");

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

beforeAll(async () => {
  priceAdmin = await import("@/lib/services/booking-price-admin");
  bookings = await import("@/lib/services/bookings");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $3, 'Price Admin A', 'active', $6),
       ($2, $4, 'Price Admin B', 'active', $6),
       ($5, $7, 'Price Admin Scoped', 'active', $6)`,
    [
      tenant,
      otherTenant,
      `b6-price-a-${RUN}`,
      `b6-price-b-${RUN}`,
      scopedTenant,
      TZ,
      `b6-price-c-${RUN}`,
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
      `+9193${String(Date.now()).slice(-8)}`,
      otherActor,
      `+9194${String(Date.now()).slice(-8)}`,
    ],
  );
}, 60_000);

afterAll(async () => {
  for (const id of [tenant, otherTenant, scopedTenant]) {
    await admin.query("delete from booking_price_rules where tenant_id = $1", [id]);
    await admin.query("delete from config_values where tenant_id = $1", [id]);
    await admin.query("delete from facilities where tenant_id = $1", [id]);
    await admin.query("delete from locations where tenant_id = $1", [id]);
    await admin.query("delete from tenants where id = $1", [id]);
  }
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

async function clearRules(tenantId: string): Promise<void> {
  await admin.query("delete from booking_price_rules where tenant_id = $1", [
    tenantId,
  ]);
}

describe("B6 booking price administration — saving a rule", () => {
  it("saves a rule and the resolver quotes exactly that price", async () => {
    await clearRules(tenant);

    const saved = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Morning rate",
      facilityId: facilityA,
      daysOfWeek: [],
      startTime: "06:00",
      endTime: "12:00",
      pricePaise: 40_000,
      priority: 0,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.rule.pricePaise).toBe(40_000);
    expect(saved.rule.label).toBe("Morning rate");
    expect(saved.rule.facilityId).toBe(facilityA);

    const quote = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "08:00"),
    });
    expect(quote).toMatchObject({ ok: true, pricePaise: 40_000 });
  });

  it("stores the price as integer paise, never a float", async () => {
    await clearRules(tenant);
    const saved = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Exact paise",
      facilityId: facilityA,
      pricePaise: 12_345,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const stored = await admin.query<{ price_paise: string }>(
      "select price_paise from booking_price_rules where id = $1",
      [saved.rule.id],
    );
    expect(stored.rows[0]?.price_paise).toBe("12345");
    expect(Number.isSafeInteger(saved.rule.pricePaise)).toBe(true);
  });

  it("refuses a rule whose end time is not after its start time", async () => {
    await clearRules(tenant);
    const bad = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Inverted",
      startTime: "12:00",
      endTime: "06:00",
      pricePaise: 10_000,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toMatch(/after/i);

    const rows = await admin.query<{ n: string }>(
      "select count(*)::text as n from booking_price_rules where tenant_id = $1",
      [tenant],
    );
    expect(Number(rows.rows[0]!.n)).toBe(0);
  });

  it("refuses a rule with only one of the two times", async () => {
    await clearRules(tenant);
    const bad = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Half window",
      startTime: "06:00",
      pricePaise: 10_000,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toMatch(/both/i);
  });

  it("refuses a negative price and a day outside the week", async () => {
    await clearRules(tenant);
    const negative = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Free",
      pricePaise: -1,
    });
    expect(negative.ok).toBe(false);

    const badDay = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Bad day",
      daysOfWeek: [7],
      pricePaise: 1_000,
    });
    expect(badDay.ok).toBe(false);

    const rows = await admin.query<{ n: string }>(
      "select count(*)::text as n from booking_price_rules where tenant_id = $1",
      [tenant],
    );
    expect(Number(rows.rows[0]!.n)).toBe(0);
  });

  it("refuses a facility that belongs to another tenant", async () => {
    await clearRules(tenant);
    const bad = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Not mine",
      facilityId: uuidv7(),
      pricePaise: 1_000,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toMatch(/facility/i);
  });

  it("keeps overlapping rules and lets the resolver's own precedence decide", async () => {
    await clearRules(tenant);

    const broad = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Broad",
      facilityId: facilityA,
      pricePaise: 30_000,
      priority: 1,
    });
    const narrow = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Narrow",
      facilityId: facilityA,
      startTime: "06:00",
      endTime: "12:00",
      pricePaise: 25_000,
      priority: 1,
    });
    expect(broad.ok).toBe(true);
    expect(narrow.ok).toBe(true);

    const rules = await priceAdmin.listBookingPriceRules(ctx);
    expect(rules).toHaveLength(2);

    const quote = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "08:00"),
    });
    expect(quote).toMatchObject({ ok: true, pricePaise: 25_000 });
  });

  it("updates the rule it was given instead of adding a second one", async () => {
    await clearRules(tenant);
    const first = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Evening rate",
      facilityId: facilityA,
      startTime: "17:00",
      endTime: "21:00",
      pricePaise: 90_000,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const updated = await priceAdmin.saveBookingPriceRule(ctx, {
      id: first.rule.id,
      label: "Evening rate",
      facilityId: facilityA,
      startTime: "17:00",
      endTime: "21:00",
      pricePaise: 95_000,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.rule.pricePaise).toBe(95_000);

    const rules = await priceAdmin.listBookingPriceRules(ctx);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.pricePaise).toBe(95_000);
  });

  it("stops resolving a deactivated rule", async () => {
    await clearRules(tenant);
    const saved = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Weekend rate",
      facilityId: facilityA,
      daysOfWeek: [1],
      pricePaise: 60_000,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const quote = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "08:00"),
    });
    expect(quote).toMatchObject({ ok: true, pricePaise: 60_000 });

    const off = await priceAdmin.setBookingPriceRuleActive(ctx, {
      id: saved.rule.id,
      isActive: false,
    });
    expect(off.ok).toBe(true);

    const after = await bookings.quoteBooking(ctx, {
      facilityId: facilityA,
      startsAt: wall(MONDAY, "08:00"),
    });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error).toMatch(/price/i);
  });

  it("writes its audit row in the same transaction", async () => {
    await clearRules(tenant);
    const saved = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Audited rate",
      facilityId: facilityA,
      pricePaise: 20_000,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const { rows } = await admin.query<{ n: string }>(
      "select count(*)::text as n from audit_log where tenant_id = $1 and action = 'booking_price_rule.create' and entity_id = $2",
      [tenant, saved.rule.id],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});

describe("B6 booking price administration — isolation", () => {
  it("never lists another tenant's rules and refuses to edit them", async () => {
    await clearRules(tenant);
    await clearRules(otherTenant);

    const mine = await priceAdmin.saveBookingPriceRule(ctx, {
      label: "Mine",
      facilityId: facilityA,
      pricePaise: 10_000,
    });
    expect(mine.ok).toBe(true);

    const theirs = await priceAdmin.saveBookingPriceRule(otherCtx, {
      label: "Theirs",
      pricePaise: 20_000,
    });
    expect(theirs.ok).toBe(true);
    if (!theirs.ok) return;

    const listed = await priceAdmin.listBookingPriceRules(ctx);
    expect(listed.map((rule) => rule.label)).toEqual(["Mine"]);

    const hijack = await priceAdmin.saveBookingPriceRule(ctx, {
      id: theirs.rule.id,
      label: "Hijacked",
      pricePaise: 1,
    });
    expect(hijack.ok).toBe(false);

    const untouched = await admin.query<{ label: string }>(
      "select label from booking_price_rules where id = $1",
      [theirs.rule.id],
    );
    expect(untouched.rows[0]?.label).toBe("Theirs");
  });

  it("keeps a location-scoped caller inside its own locations", async () => {
    await clearRules(scopedTenant);
    await admin.query(
      `insert into config_values (key, scope_type, scope_id, tenant_id, value)
       values ('access.location_scoped_staff', 'tenant', $1, $2, 'true'::jsonb)
       on conflict do nothing`,
      [scopedTenant, scopedTenant],
    );

    const inside = await priceAdmin.saveBookingPriceRule(scopedCtx, {
      label: "Scoped A rate",
      facilityId: scopedFacilityA,
      pricePaise: 15_000,
    });
    expect(inside.ok).toBe(true);

    const outside = await priceAdmin.saveBookingPriceRule(scopedCtx, {
      label: "Scoped B rate",
      facilityId: scopedFacilityB,
      pricePaise: 16_000,
    });
    expect(outside.ok).toBe(false);
    if (outside.ok) return;
    expect(outside.error).toMatch(/facility/i);

    // Another location's rule exists, but a scoped caller neither sees
    // it in the list nor may change it.
    const unrestricted = {
      tenantId: scopedTenant,
      userId: actor,
      requestId: uuidv7(),
      allLocations: true,
      locationIds: [] as string[],
    };
    const elsewhere = await priceAdmin.saveBookingPriceRule(unrestricted, {
      label: "Scoped B rate",
      facilityId: scopedFacilityB,
      pricePaise: 17_000,
    });
    expect(elsewhere.ok).toBe(true);

    const listed = await priceAdmin.listBookingPriceRules(scopedCtx);
    expect(listed.map((rule) => rule.label)).toEqual(["Scoped A rate"]);

    const editElsewhere = await priceAdmin.saveBookingPriceRule(scopedCtx, {
      id: elsewhere.ok ? elsewhere.rule.id : undefined,
      label: "Hijacked",
      pricePaise: 1,
    });
    expect(editElsewhere.ok).toBe(false);
  });
});
