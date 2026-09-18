import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, type TenantId } from "@/lib/ids";
import { runEventsRollupJob } from "@/lib/jobs/events-rollup-job";

// E-06 (rollup half) — events.rollup folds one tenant-local day of
// activity_events into that tenant's daily_rollups row.
//
// Written before db/migrations/20260918080000_e06_daily_rollups_events.sql
// and lib/jobs/events-rollup-job.ts exist: the first run of this file
// is deliberately red. Fixture rows for `tenants` / `activity_events`
// / `daily_rollups` (all FORCE RLS) go through the privileged
// migration pool, the same style as tests/tier1/activity-events.test.ts;
// the only app-path call is runEventsRollupJob itself.
//
// Days are fixed 2026-09 dates inside activity_events' created
// partitions, and "day A" is passed explicitly so this test is
// deterministic regardless of when it runs (the scheduled path
// defaults to yesterday in the tenant's timezone).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const TZ = "Asia/Kolkata";
const DAY_A = "2026-09-15";
const DAY_B = "2026-09-16";

const tenantIds: TenantId[] = [];

async function makeTenant(label: string): Promise<TenantId> {
  const id = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', $4)",
    [id, `e06-${label}-${RUN}`, `E06 ${label}`, TZ],
  );
  tenantIds.push(id);
  return id;
}

async function insertEvent(
  tenantId: TenantId,
  occurredAt: Date,
  eventName: string,
): Promise<void> {
  await admin.query(
    `insert into activity_events
       (id, tenant_id, occurred_at, event_name, source, client_event_id)
     values ($1, $2, $3, $4, 'job', $5)`,
    [uuidv7(), tenantId, occurredAt, eventName, `e06-${uuidv7()}`],
  );
}

function rollupRow(tenantId: TenantId, onDate: string) {
  return admin
    .query<{
      event_counts: Record<string, number>;
      events_total: number;
      sessions_held: number;
      attendance_marked: number;
      new_members: number;
      payments_count: number;
      collections_paise: string;
      invoices_issued: number;
      invoices_total_paise: string;
      computed_at: Date;
    }>(
      `select event_counts, events_total, sessions_held, attendance_marked,
              new_members, payments_count, collections_paise,
              invoices_issued, invoices_total_paise, computed_at
         from daily_rollups
        where tenant_id = $1 and on_date = $2`,
      [tenantId, onDate],
    )
    .then((r) => r.rows[0]);
}

afterAll(async () => {
  if (tenantIds.length > 0) {
    await admin.query("delete from activity_events where tenant_id = any($1::uuid[])", [
      tenantIds,
    ]);
    await admin.query("delete from daily_rollups where tenant_id = any($1::uuid[])", [
      tenantIds,
    ]);
    await admin.query("delete from tenants where id = any($1::uuid[])", [tenantIds]);
  }
  await admin.end();
});

describe("E-06 — events.rollup", () => {
  it("folds the day's events into event_counts and events_total", async () => {
    const tenantId = await makeTenant("fold");
    // Day A (IST): two attendance marks and one correction.
    await insertEvent(tenantId, new Date("2026-09-15T04:30:00.000Z"), "session.attendance_marked");
    await insertEvent(tenantId, new Date("2026-09-15T06:15:00.000Z"), "session.attendance_marked");
    await insertEvent(tenantId, new Date("2026-09-15T12:00:00.000Z"), "session.attendance_corrected");
    // Day B: different shape, must not leak into day A.
    await insertEvent(tenantId, new Date("2026-09-16T04:30:00.000Z"), "session.attendance_marked");

    await runEventsRollupJob(tenantId, DAY_A);

    const row = await rollupRow(tenantId, DAY_A);
    expect(row).toBeDefined();
    expect(row!.event_counts).toEqual({
      "session.attendance_marked": 2,
      "session.attendance_corrected": 1,
    });
    expect(row!.events_total).toBe(3);

    const dayB = await rollupRow(tenantId, DAY_B);
    expect(dayB).toBeUndefined();
  });

  it("is idempotent: a re-run reports the same counts and one row", async () => {
    const tenantId = await makeTenant("idempotent");
    await insertEvent(tenantId, new Date("2026-09-15T04:30:00.000Z"), "session.attendance_marked");
    await insertEvent(tenantId, new Date("2026-09-15T05:30:00.000Z"), "session.attendance_corrected");

    await runEventsRollupJob(tenantId, DAY_A);
    const first = await rollupRow(tenantId, DAY_A);

    await runEventsRollupJob(tenantId, DAY_A);
    const second = await rollupRow(tenantId, DAY_A);

    expect(second!.event_counts).toEqual(first!.event_counts);
    expect(second!.events_total).toBe(first!.events_total);
    expect(second!.events_total).toBe(2);
    const { rows } = await admin.query<{ count: number }>(
      "select count(*)::int as count from daily_rollups where tenant_id = $1 and on_date = $2",
      [tenantId, DAY_A],
    );
    expect(rows[0]!.count).toBe(1);
  });

  it("updates only the event columns, never the reports.rollup counters", async () => {
    const tenantId = await makeTenant("no-clobber");
    await insertEvent(tenantId, new Date("2026-09-15T04:30:00.000Z"), "session.attendance_marked");

    // A row the nightly reports.rollup already wrote (it runs first,
    // at 03:00; events.rollup at 03:15 must not reset it).
    await admin.query(
      `insert into daily_rollups
         (tenant_id, on_date, sessions_held, attendance_marked, new_members,
          payments_count, collections_paise, invoices_issued, invoices_total_paise)
       values ($1, $2, 4, 9, 2, 3, 123456, 1, 654321)`,
      [tenantId, DAY_A],
    );

    await runEventsRollupJob(tenantId, DAY_A);

    const row = await rollupRow(tenantId, DAY_A);
    expect(row!.event_counts).toEqual({ "session.attendance_marked": 1 });
    expect(row!.events_total).toBe(1);
    expect(row!.sessions_held).toBe(4);
    expect(row!.attendance_marked).toBe(9);
    expect(row!.new_members).toBe(2);
    expect(row!.payments_count).toBe(3);
    expect(row!.collections_paise).toBe("123456");
    expect(row!.invoices_issued).toBe(1);
    expect(row!.invoices_total_paise).toBe("654321");
  });

  it("excludes events outside the tenant-local day boundary", async () => {
    const tenantId = await makeTenant("exclude");
    // 2026-09-14 17:00Z is 22:30 IST on the 14th — before day A
    // starts (day A begins 2026-09-14 18:30Z in IST).
    await insertEvent(tenantId, new Date("2026-09-14T17:00:00.000Z"), "session.attendance_marked");
    // 2026-09-15 19:00Z is 00:30 IST on the 16th — already day B.
    await insertEvent(tenantId, new Date("2026-09-15T19:00:00.000Z"), "session.attendance_marked");

    await runEventsRollupJob(tenantId, DAY_A);

    const row = await rollupRow(tenantId, DAY_A);
    expect(row!.event_counts).toEqual({});
    expect(row!.events_total).toBe(0);
  });
});
