import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/db/tenant";
import { locations } from "@/db/schema";
import { getOwnerCharts } from "@/lib/services/owner-home-charts";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";

// Owner Home trend band — the service boundary at EXACT IST midnight.
//
// The service drops buckets that have not started yet, so a
// period-to-date axis never shows a future slot. At exactly 00:00 IST
// the "today" bucket of a Last-7-days window starts AT that instant,
// so the strict "started before now" filter removed it and the range
// came back with six calendar dates instead of seven.
//
// The Last 7 days window is a count of CALENDAR DATES, so all seven
// dates belong to it: today is the last one and it is simply empty (or
// unknown for attendance) until the day fills in. The shorter and
// longer ranges keep their existing behaviour — a Day axis still ends
// at the current hour, and a week/month axis still shows only the
// slots that have happened.

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

/** Exact IST midnight on 31 October 2026. */
const IST_MIDNIGHT = new Date("2026-10-31T00:00:00+05:30").getTime();

let tenantId: TenantId = asTenantId("");

const owner = {
  userId: asUserId(randomUUID()),
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
};

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Range Boundary', $3)",
    [tenantId, `range-boundary-${RUN}`, TZ],
  );
  await admin.query("insert into tenant_features (tenant_id,feature_key,enabled) values ($1,'reports',true),($1,'billing',true)", [tenantId]);
  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(locations)
      .values({ tenantId, name: "Range Boundary Pool", isPrimary: true });
  });
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenant_features where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("owner charts — the Last 7 days window at the IST midnight boundary", () => {
  it("keeps seven calendar dates at exactly 00:00 IST", async () => {
    const data = await getOwnerCharts(
      { tenantId, ...owner },
      { period: "last7", now: IST_MIDNIGHT },
    );

    expect(data.period.key).toBe("last7");
    // Seven dates, oldest first, ending today.
    expect(data.collections.buckets.map((bucket) => bucket.key)).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    expect(data.attendance.buckets).toHaveLength(7);
  }, 60_000);

  it("shows today as empty, and attendance as unknown rather than zero", async () => {
    const data = await getOwnerCharts(
      { tenantId, ...owner },
      { period: "last7", now: IST_MIDNIGHT },
    );

    // Nothing was recorded in the window, so the totals are zero…
    expect(data.collections.totalPaise).toBe(0);
    expect(data.collections.paymentCount).toBe(0);
    // …and every bucket, today included, is a real date with no money
    // in it — not a missing day.
    expect(data.collections.buckets.every((bucket) => bucket.totalPaise === 0)).toBe(true);
    // Attendance was not recorded either: unknown, never 0%.
    expect(data.attendance.total).toBe(0);
    expect(data.attendance.pct).toBeNull();
    expect(data.attendance.buckets.every((bucket) => bucket.pct === null)).toBe(true);
  }, 60_000);

  it("keeps the future-bucket behaviour of the Day and Week ranges", async () => {
    const day = await getOwnerCharts(
      { tenantId, ...owner },
      { period: "day", now: IST_MIDNIGHT },
    );
    // UNCHANGED behaviour: a period-to-date axis shows only the slots
    // that have started, so the Day axis has no hour yet at 00:00.
    expect(day.collections.buckets).toHaveLength(0);

    const week = await getOwnerCharts(
      { tenantId, ...owner },
      { period: "week", now: IST_MIDNIGHT },
    );
    // UNCHANGED behaviour: Monday-to-now, so Saturday has not started
    // and the axis stops at Friday.
    expect(week.collections.buckets).toHaveLength(5);
    expect(week.collections.buckets[0]!.key).toBe("2026-10-26");
    expect(week.collections.buckets.at(-1)!.key).toBe("2026-10-30");
  }, 60_000);
});
