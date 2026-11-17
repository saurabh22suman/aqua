// U-01 — inline SVG charts. No charting dependency: these are plain
// server-rendered SVG built from the design tokens (water for data,
// deck for tracks, line for rules). Colour here is data, never
// decoration, per DESIGN.md's thesis.
//
// Every chart tolerates a single point and an empty series; the card
// wrappers own the honest empty state copy, these primitives simply
// never invent a point.
//
// The time series (the attendance line and the collections columns) and
// the member mix ring live in their own files under this folder since
// 30 October 2026: they grew axes, and the frame they share is a
// separate reason to change.

export { ColumnChart } from "./report-column-chart";
export { Donut, type DonutSlice } from "./report-donut";
export { LineTrend } from "./report-line-trend";
export { ReportDataTable, type ReportTableColumn } from "./report-data-table";
export type { ChartPoint } from "./report-chart-scale";

import { ProgressBar } from "@/components/ui/ProgressBar";

export function HorizontalBars({
  rows,
  ariaLabel,
  valueLabel,
}: {
  rows: Array<{ label: string; value: number; hint?: string }>;
  ariaLabel: string;
  /** The exact amount, shown next to the category. */
  valueLabel?: (value: number) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  // 30 October 2026 — the plan bars are HTML rows, not an SVG.
  //
  // The SVG drew the category in a fixed 96px column and cut the text
  // at 18 characters, which is about 110px of type: "Annual
  // Membership" sat on top of the bar track (measured in Chrome: a
  // 12.4px overlap on the first label, 19.6px on the second). The cut
  // was a guess about the type's width, and a guess cannot be right
  // for every name.
  //
  // In a row the browser owns the space: the category is real text in
  // its own column, ellipsised when it does not fit and carrying the
  // full name for a screen reader and for the title attribute; the
  // amount is written out when the caller formats it, so the exact
  // figure is readable without hovering anything; and the bar is on
  // its own line below, so a long name can never reach the track. The
  // bar is the shared ProgressBar, so a plan bar looks like every
  // other meter in Aqua.
  return (
    <ul className="space-y-3" aria-label={ariaLabel}>
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span
              data-bar-label
              className="min-w-0 truncate text-[13px] text-ink-2"
              title={row.label}
            >
              {row.label}
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
              {valueLabel ? valueLabel(row.value) : null}
            </span>
          </div>
          <div data-bar-track className="mt-1.5">
            <ProgressBar
              value={row.value}
              max={max}
              label={`${row.label}: ${row.hint ?? valueLabel?.(row.value) ?? row.value}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
