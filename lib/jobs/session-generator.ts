import { sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { batches, sessions } from "@/db/schema";
import type { TenantId } from "@/lib/ids";
import {
  addDays,
  todayInZone,
  weekdayOf,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";

const DAYS_AHEAD = 28;

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

  for (const batch of activeBatches) {
    for (let date = today; date <= horizon; date = addDays(date, 1)) {
      if (!batch.daysOfWeek.includes(weekdayOf(date))) continue;

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
