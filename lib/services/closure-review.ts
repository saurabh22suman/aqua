import { and, asc, eq, gte, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { tenantHolidays } from "@/db/schema/tenant-holidays";
import { sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { callerIsLiveOwnerForSettingsOrDelegation } from "@/lib/services/owner-authority";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";
import { addDays, todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

export type ClosureReview = { holidayId:string; through:string; truncated:boolean; sessions:Array<{id:string; batchName:string; date:string; locationId:string | null; locationName:string | null; status:string}> };
const LIMIT = 200;

/** Read-only, bounded to the next 366 tenant-local days and live owner scope. */
export async function reviewClosure(ctx: ActionCtx, holidayId: string): Promise<ClosureReview | null> {
  if (!z.string().uuid().safeParse(holidayId).success) return null;
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await callerIsLiveOwnerForSettingsOrDelegation(tx, ctx))) return null;
    const [holiday] = await tx.select().from(tenantHolidays).where(and(eq(tenantHolidays.tenantId,ctx.tenantId),eq(tenantHolidays.id,holidayId))).limit(1);
    const [tenant] = await tx.select({timezone:tenants.timezone}).from(tenants).where(eq(tenants.id,ctx.tenantId)).limit(1);
    if (!holiday || !tenant) return null;
    const today = todayInZone(tenant.timezone);
    const through = addDays(today,366);
    const access = await resolveLocationAccess(tx,ctx);
    const conditions = [eq(sessions.tenantId,ctx.tenantId),gte(sessions.sessionDate,today),lte(sessions.sessionDate,through),gt(sessions.startsAt,new Date()),eq(sessions.status,"scheduled"),
      or(isNull(sessions.locationId),isNotNull(locations.id))!,
      holiday.recurringYearly ? sql`to_char(${sessions.sessionDate}, 'MM-DD') = ${holiday.holidayDate.slice(5)}` : eq(sessions.sessionDate,holiday.holidayDate)];
    const scope = locationPredicate(sessions.locationId,access);
    if (scope) conditions.push(scope);
    const rows = await tx.select({id:sessions.id,batchName:batches.name,date:sessions.sessionDate,locationId:sessions.locationId,locationName:locations.name,status:sessions.status})
      .from(sessions).innerJoin(batches,and(eq(batches.id,sessions.batchId),eq(batches.tenantId,ctx.tenantId),isNull(batches.deletedAt)))
      .leftJoin(locations,and(eq(locations.id,sessions.locationId),eq(locations.tenantId,ctx.tenantId),isNull(locations.deletedAt)))
      .where(and(...conditions)).orderBy(asc(sessions.sessionDate),asc(sessions.startsAt)).limit(LIMIT+1);
    return {holidayId,through,truncated:rows.length>LIMIT,sessions:rows.slice(0,LIMIT)};
  });
}
