// Why the tier1 booking price-snapshot test fails on a Monday.
//
// tests/tier1/bookings-pricing.test.ts ("snapshots the resolved price
// onto the booking; later rule changes do not rewrite it") fails with
// `created.ok === false` when the suite runs on a MONDAY. This file is
// the diagnosis: it reproduces the test's own arithmetic for every
// weekday against the product's own advance-window check, and proves
// two things.
//
//   1. The PRODUCT is correct: a start beyond `now + maxDays` is
//      refused, which is the documented rule
//      (lib/services/booking-pricing.ts). The tenant override is
//      honoured, and the message names the limit.
//
//   2. The TEST is clock-dependent and order-dependent. Its start date
//      is "the next Monday", computed from the wall clock, and the
//      preceding test in the same file leaves a tenant-scoped
//      `bookings.advance_window_days = 7` override behind (it never
//      removes it). On a Monday the next Monday is exactly seven days
//      out, and a 14:00 start is later than the same wall-clock time
//      seven days back — so the booking falls outside the seven-day
//      window that the earlier test installed.
//
// Nothing here changes the product, and nothing here edits the
// protected test. The proposed protected-test patch is recorded in
// docs/handoffs/batch4.md.
//
// The privileged pool is used for fixture setup only (the tenant row and
// the tenant-scoped config override); the check under test runs inside
// withTenant() on the application's own pool.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { checkAdvanceWindowInTx } from "@/lib/services/booking-pricing";
import { addDays, weekdayOf, zonedWallTimeToInstant } from "@/lib/time/tz";
import { asTenantId } from "@/lib/ids";
import { privilegedFixturePool as admin } from "./privileged-fixture";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

// A fixed week, so the diagnosis does not itself race the clock. It is
// the week the tier1 failure was observed in: Monday 26 October 2026
// through Sunday 1 November 2026.
const WEEK = [
  "2026-10-26", // Monday
  "2026-10-27", // Tuesday
  "2026-10-28", // Wednesday
  "2026-10-29", // Thursday
  "2026-10-30", // Friday
  "2026-10-31", // Saturday
  "2026-11-01", // Sunday
];

const tenant = asTenantId(uuidv7());
const location = uuidv7();
const ADVANCE_KEY = "bookings.advance_window_days";

/** The tier1 test's own helper: the next given weekday AFTER today. */
function dateForDow(target: number, todayIso: string): string {
  let date = addDays(todayIso, 1);
  for (let i = 0; i < 7; i++) {
    if (weekdayOf(date) === target) return date;
    date = addDays(date, 1);
  }
  throw new Error("unreachable");
}

/** The tier1 test's own booking: the next Monday at 14:00 IST. */
function nextMondayBooking(todayIso: string): Date {
  return new Date(
    zonedWallTimeToInstant(dateForDow(1, todayIso), "14:00", TZ),
  );
}

/** Midday on the given day — the moment the tier1 test runs. */
function midday(todayIso: string): Date {
  return new Date(zonedWallTimeToInstant(todayIso, "12:00", TZ));
}

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Clock Diagnosis', $3)",
    [tenant, `clock-diagnosis-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Diagnosis Site', true)",
    [location, tenant],
  );
});

afterAll(async () => {
  await admin.query("delete from config_values where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.end();
});

async function setAdvanceWindow(days: number | null): Promise<void> {
  await admin.query("delete from config_values where tenant_id = $1 and key = $2", [
    tenant,
    ADVANCE_KEY,
  ]);
  if (days === null) return;
  await admin.query(
    `insert into config_values (key, scope_type, scope_id, tenant_id, value)
     values ($1, 'tenant', $2, $3, $4::jsonb)`,
    [ADVANCE_KEY, tenant, tenant, JSON.stringify(days)],
  );
}

async function windowError(startsAt: Date, now: Date): Promise<string | null> {
  return withTenant(tenant, async (tx) =>
    checkAdvanceWindowInTx(tx, tenant, location, startsAt, now),
  );
}

describe("advance-window boundary — the price-snapshot scenario", () => {
  it("refuses the next-Monday booking on a Monday under a seven-day window, and allows it on the other six days", async () => {
    await setAdvanceWindow(7);
    const refused: string[] = [];
    const allowed: string[] = [];
    for (const today of WEEK) {
      const error = await windowError(nextMondayBooking(today), midday(today));
      if (error) refused.push(`${today} (${weekdayOf(today)}): ${error}`);
      else allowed.push(`${today} (${weekdayOf(today)})`);
    }
    // The only day the tier1 test fails on.
    expect(refused.map((entry) => entry.slice(0, 10))).toEqual(["2026-10-26"]);
    expect(allowed).toHaveLength(6);
  });

  it("allows the next-Monday booking on every weekday under the default thirty-day window", async () => {
    await setAdvanceWindow(null);
    for (const today of WEEK) {
      const error = await windowError(nextMondayBooking(today), midday(today));
      expect(error, `${today} must be inside the default window`).toBeNull();
    }
  });

  it("keeps the refusal honest: the message names the configured limit", async () => {
    await setAdvanceWindow(7);
    const error = await windowError(nextMondayBooking("2026-10-26"), midday("2026-10-26"));
    expect(error).toContain("7 days");
  });

  it("depends on the TIME OF DAY too: before 14:00 IST on the Monday the booking is refused, after it is allowed", async () => {
    await setAdvanceWindow(7);
    const before = await windowError(
      nextMondayBooking("2026-10-26"),
      new Date(zonedWallTimeToInstant("2026-10-26", "10:45", TZ)),
    );
    expect(before).toContain("7 days");

    const after = await windowError(
      nextMondayBooking("2026-10-26"),
      new Date(zonedWallTimeToInstant("2026-10-26", "20:00", TZ)),
    );
    expect(after).toBeNull();
  });
});
