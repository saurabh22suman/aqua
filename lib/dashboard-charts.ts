import { addDays } from "@/lib/time/tz";

// Dashboard chart helpers. The owner landing trends are interactive on
// desktop (ECharts island, lazily loaded) and plain server SVG below
// lg, per DESIGN.md §5 ("no chart library on any mobile route …
// lazy-load behind interaction").
//
// Drill-through is a URL template with {from}/{to} placeholders — a
// plain string so it can cross the server → client boundary. Clicking
// a day on the chart lands on the report for that day, matching the
// Power BI / Jackrabbit drill pattern: summary → filtered detail →
// back link.

export type DashboardTrendPoint = { date: string; value: number | null };

export function formatDrillHref(template: string, date: string): string {
  return template.replaceAll("{from}", date).replaceAll("{to}", addDays(date, 1));
}

// ECharts axis labels receive raw paise from the money services. The
// axis needs a compact rupee figure, so divide by 100 before
// compacting — without this every label reads 100× (₹1.5L for ₹1,500,
// caught in the owner-dashboard browser pass).
export function compactPaiseINR(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 100000) {
    return `₹${(rupees / 100000).toFixed(1).replace(/\.0$/, "")}L`;
  }
  if (rupees >= 1000) {
    return `₹${(rupees / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `₹${Math.round(rupees)}`;
}

export const COLLECTIONS_DRILL = "/owner/fees?tab=transactions&from={from}&to={to}";
export const ATTENDANCE_DRILL = "/owner/reports?from={from}&to={to}";
