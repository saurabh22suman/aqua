import { and, eq, gte, lt, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { activityEvents } from "@/db/schema/activity-events";
import { dailyRollups } from "@/db/schema/daily-rollups";
import { addDays, dayRangeUtc, todayInZone } from "@/lib/time/tz";
import type { TenantId } from "@/lib/ids";

// E-06 (rollup half) — events.rollup. Folds one tenant-local day of
// activity_events into that tenant's daily_rollups row:
//
//   event_counts  { [event_name]: count } for the day
//   events_total  the sum of those counts
//
// The row is shared with reports.rollup (C-47), which runs at 03:00
// tenant time; this job runs at 03:15 and its upsert's on-conflict set
// touches ONLY the two event columns (plus computed_at), so a
// pre-existing sessions_held / collections_paise / ... from the
// reports rollup is never rewritten, and vice versa. Idempotent by
// primary key: a re-run recomputes the same counts and writes the same
// values.
//
// The day defaults to yesterday in the tenant's timezone — the same
// boundary reports.rollup uses, and the boundary the schedule fires
// on. An explicit `onDate` ("YYYY-MM-DD", tenant-local) is accepted for
// backfills and deterministic tests; the UTC window is still derived
// from the tenant's timezone, so a job run from any server always
// means the academy's day, not the server's (dayRangeUtc in
// lib/time/tz.ts).
//
// Grouping is over whatever rows are persisted: the registry gate
// (lib/events/registry.ts) runs at ingest, not here, so a retired
// event name still rolls up its historical counts rather than
// vanishing from the totals.
//
// DEFERRED (out of scope for this workstream): R2/Parquet export of
// closed partitions and dropping raw partitions past the retention
// window. No R2 integration exists, and partition DROP is DDL that
// app_user — and therefore this job — cannot execute. See
// db/migrations/20260918080000_e06_daily_rollups_events.sql.
export async function runEventsRollupJob(
  tenantId: TenantId,
  onDate?: string,
): Promise<void> {
  const summary = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: tenants.status, timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!row || (row.status !== "trial" && row.status !== "active")) {
      return null;
    }

    const date = onDate ?? addDays(todayInZone(row.timezone), -1);
    const { fromUtc, toUtc } = dayRangeUtc(date, row.timezone);

    const groups = await tx
      .select({
        eventName: activityEvents.eventName,
        count: sql<number>`count(*)::int`,
      })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.tenantId, tenantId),
          gte(activityEvents.occurredAt, fromUtc),
          lt(activityEvents.occurredAt, toUtc),
        ),
      )
      .groupBy(activityEvents.eventName);

    const eventCounts: Record<string, number> = {};
    let eventsTotal = 0;
    for (const group of groups) {
      eventCounts[group.eventName] = group.count;
      eventsTotal += group.count;
    }

    // Disjoint set list on purpose: this job owns event_counts /
    // events_total only. The other columns belong to reports.rollup.
    await tx
      .insert(dailyRollups)
      .values({
        tenantId,
        onDate: date,
        eventCounts,
        eventsTotal,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dailyRollups.tenantId, dailyRollups.onDate],
        set: { eventCounts, eventsTotal, computedAt: new Date() },
      });

    return { onDate: date, eventsTotal };
  });

  if (summary) {
    console.log(
      `[events.rollup] tenant ${tenantId} ${summary.onDate}: ` +
        `${summary.eventsTotal} event(s)`,
    );
  }
}
