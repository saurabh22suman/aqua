import { sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { batches, sessions } from "@/db/schema";
import { tenantHolidays } from "@/db/schema/tenant-holidays";
import type { TenantId } from "@/lib/ids";
import {
  addDays,
  todayInZone,
  weekdayOf,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";
import { isHoliday } from "@/lib/services/holidays";

const DAYS_AHEAD = 28;

// Phase R.3 — session generation now respects tenant holidays.
// On every loop, we ask the holidays service for the pre-fetched
// sets (one-off dates + recurring month-day tuples) for the
// tenant, then skip any date that matches. This is the named
// failure class: "a national holiday still generates a session
// and a coach registers against an empty pool." isHoliday()
// returns true for either kind.
//
// Single fetch at the top of the run — the per-batch loop is
// just an O(1) lookup against the pre-built Set. Holiday set
// counts: a tenant with 5-10 declared holidays per year is the
// upper end; the in-memory cost is trivial.

export async function generateSessions(
  tx: TenantTx,
  tenantId: TenantId,
  tenantTimezone: string,
): Promise<number> {
  const activeBatches = await tx
    .select()
    .from(batches)
    .where(sql`${batches.tenantId} = ${tenantId} and ${batches.deletedAt} is null`);

  const today = todayInZone(tenantTimezone);
  const horizon = addDays(today, DAYS_AHEAD - 1);
  let created = 0;

  // Pre-fetch the holiday set for the run window. The service
  // is called directly here (not via the action layer) because
  // we already have a tx and a tenantId in scope; the action
  // layer is for owner-UI surfaces.
  const holidayRows = await tx
    .select({
      holidayDate: tenantHolidays.holidayDate,
      recurringYearly: tenantHolidays.recurringYearly,
    })
    .from(tenantHolidays)
    .where(sql`${tenantHolidays.tenantId} = ${tenantId}`);
  const oneOff = new Set<string>();
  const recurring = new Set<string>();
  for (const r of holidayRows) {
    if (r.recurringYearly) {
      // holidayDate is a YYYY-MM-DD string from drizzle's date column.
      const parts = r.holidayDate.split("-");
      recurring.add(`${parts[1]}-${parts[2]}`);
    } else {
      oneOff.add(r.holidayDate);
    }
  }

  for (const batch of activeBatches) {
    for (let date = today; date <= horizon; date = addDays(date, 1)) {
      if (!batch.daysOfWeek.includes(weekdayOf(date))) continue;
      // R.3 — skip the date if it's a tenant holiday (one-off
      // or recurring). The MM-DD slice is local-time per the
      // tenant's wall clock, so 2027-08-15 and 2028-08-15 both
      // match a recurring Aug-15 holiday without a year leak.
      if (isHoliday(date, { oneOff, recurring })) continue;

      const startsAt = zonedWallTimeToInstant(date, batch.startTime, tenantTimezone);
      const endsAt = zonedWallTimeToInstant(date, batch.endTime, tenantTimezone);

      const inserted = await tx
        .insert(sessions)
        .values({
          tenantId,
          batchId: batch.id,
          sessionDate: date,
          startsAt,
          endsAt,
          coachId: batch.coachId,
        })
        .onConflictDoNothing()
        .returning({ id: sessions.id });

      created += inserted.length;
    }
  }

  return created;
}
