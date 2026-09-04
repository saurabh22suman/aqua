import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenantHolidays } from "@/db/schema/tenant-holidays";
import type { ActionCtx } from "@/lib/auth/context";
import { z } from "zod";

// Phase R.3 — holiday and closure calendar. The session
// generator (lib/jobs/session-generator.ts) consults this
// service per batch date; if the date is a tenant holiday
// (one-off or recurring), the generator skips generation for
// that date.
//
// "Without this, a national holiday still generates a session
// and a coach registers against an empty pool" (work guide).
// The schema (db/migrations/20260904100000_tenant_holidays.sql)
// enforces the (tenant, holiday_date) and
// (tenant, month, day) unique partials. Drizzle's partial-index
// support is limited so the migration is the source of truth
// for the second unique; the schema covers the row shape.

const NAME_MIN = 1;
const NAME_MAX = 120;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type HolidayResult =
  | { kind: "ok"; holidayId: string }
  | {
      kind: "error";
      code:
        | "invalid"
        | "duplicate"
        | "not_found";
      message: string;
    };

// Pre-fetch the holiday set for a date range and serve it as
// a Set<string> the generator can consult in O(1). The
// generator's hot path is one O(range) query per run; the
// in-memory set is small (a few entries per tenant per year).
export async function listHolidaysInRange(
  ctx: ActionCtx,
  fromDate: string,
  toDate: string,
): Promise<{ oneOff: Set<string>; recurring: Set<string> }> {
  return withTenant(ctx.tenantId, async (tx) => {
    // One-off holidays fall within [from, to] inclusive.
    // Recurring holidays: a recurring_yearly holiday with
    // holiday_date month=X day=Y applies to every year; we
    // need to know which ones apply within the queried range.
    // The generator calls this once per run with from=daysAgo
    // and to=horizon — even a 4-week window can't have more
    // than ~20 holidays (most tenants declare 5-10 per year).
    // We pull everything for the tenant once and let the
    // caller filter by month-day.
    void fromDate;
    void toDate;
    const rows = await tx
      .select({
        holidayDate: tenantHolidays.holidayDate,
        recurringYearly: tenantHolidays.recurringYearly,
      })
      .from(tenantHolidays)
      .where(eq(tenantHolidays.tenantId, ctx.tenantId));
    const oneOff = new Set<string>();
    const recurring = new Set<string>();
    for (const r of rows) {
      if (r.recurringYearly) {
        // MM-DD
        const parts = r.holidayDate.split("-");
        recurring.add(`${parts[1]}-${parts[2]}`);
      } else {
        oneOff.add(r.holidayDate);
      }
    }
    return { oneOff, recurring };
  });
}

const addSchema = z.object({
  name: z.string().trim().min(NAME_MIN).max(NAME_MAX),
  holidayDate: z.string().regex(YMD, "holidayDate must be YYYY-MM-DD"),
  recurringYearly: z.boolean().optional().default(false),
});

export async function addHoliday(
  ctx: ActionCtx,
  raw: unknown,
): Promise<HolidayResult> {
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid holiday request.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    try {
      const [row] = await tx
        .insert(tenantHolidays)
        .values({
          tenantId: ctx.tenantId,
          name: parsed.data.name,
          holidayDate: parsed.data.holidayDate,
          recurringYearly: parsed.data.recurringYearly ?? false,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: tenantHolidays.id });
      return { kind: "ok", holidayId: row!.id };
    } catch (err) {
      // The unique partial indexes on tenant_holidays surface
      // as 23505 (unique_violation). Drizzle may wrap the pg error
      // in a higher-level exception; walk the cause chain to find
      // the underlying code. Translate to a typed duplicate result
      // rather than a generic error.
      let code: string | undefined = (err as { code?: string }).code;
      let cursor: unknown = err;
      while (!code && cursor && typeof cursor === "object" && "cause" in cursor) {
        cursor = (cursor as { cause: unknown }).cause;
        code = (cursor as { code?: string } | null)?.code;
      }
      if (code === "23505") {
        return {
          kind: "error",
          code: "duplicate",
          message:
            "A holiday on that date already exists for this tenant.",
        };
      }
      throw err;
    }
  });
}

const removeSchema = z.object({
  holidayId: z.string().uuid(),
});

export async function removeHoliday(
  ctx: ActionCtx,
  raw: unknown,
): Promise<HolidayResult> {
  const parsed = removeSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid holiday id." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .delete(tenantHolidays)
      .where(
        and(
          eq(tenantHolidays.id, parsed.data.holidayId),
          eq(tenantHolidays.tenantId, ctx.tenantId),
        ),
      )
      .returning({ id: tenantHolidays.id });
    if (!row) {
      return { kind: "error", code: "not_found", message: "Holiday not found." };
    }
    return { kind: "ok", holidayId: row.id };
  });
}

// isHoliday — quick O(1) check used by the session generator
// once it has the pre-fetched sets. Pure function; no DB.
export function isHoliday(
  dateStr: string,
  holidays: { oneOff: Set<string>; recurring: Set<string> },
): boolean {
  if (holidays.oneOff.has(dateStr)) return true;
  // MM-DD portion of YYYY-MM-DD
  const mmdd = dateStr.slice(5);
  return holidays.recurring.has(mmdd);
}

void sql;
