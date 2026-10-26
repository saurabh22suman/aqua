import { z } from "zod";
import { dayRangeUtc } from "@/lib/time/tz";

// The owner-insights window. One shape for both read models so the
// chart and its detail view can never disagree about which days are
// on screen.
//
// `from` is inclusive, `to` is EXCLUSIVE (the first day AFTER the
// last included day) — the same convention the existing reports use
// (lib/services/owner-reports.ts). A single-day window is therefore
// from = 2026-06-01, to = 2026-06-02.
//
// The dates are calendar days in the TENANT's timezone (IST for the
// clubs that run today), never UTC days: a window that starts at
// 00:00 IST is 18:30 UTC the previous day, and a UTC-day window
// would silently drop the club's first working hour.
//
// The date check is a REAL calendar check, not a shape check. A regex
// alone accepts "2026-02-30" and "2026-13-01" — days that never
// happened — and a window naming one of them asks the query for a day
// that does not exist, which comes back as an honest-looking empty
// result. `z.iso.date()` is the library's own ISO-date validator: it
// applies the Gregorian calendar (leap years included) and keeps the
// repository's existing "Use a YYYY-MM-DD date." message.
//
// One schema, one refine: extending a refined object schema throws
// in Zod 4 when the new key overlaps, so the location filter is part
// of the shape rather than an `.extend()` on top of it.

const isoDate = z.iso.date({ error: "Use a YYYY-MM-DD date." });

export const ownerInsightInputSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    locationId: z.string().uuid().optional(),
  })
  .refine((input) => input.to > input.from, {
    message: "The period end must be after the period start.",
    path: ["to"],
  });

export type OwnerInsightInput = z.infer<typeof ownerInsightInputSchema>;

// The UTC instants bounding the window in the tenant's own timezone.
// `to` is exclusive, so the window closes at the START of the `to`
// day — the same half-open range every other report uses.
export function periodWindowUtc(
  period: { from: string; to: string },
  timezone: string,
): { fromUtc: Date; toUtc: Date } {
  return {
    fromUtc: dayRangeUtc(period.from, timezone).fromUtc,
    toUtc: dayRangeUtc(period.to, timezone).fromUtc,
  };
}
