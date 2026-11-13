import type { ReactNode } from "react";

import { chartDateLabel, chartTickIndices } from "./report-chart-scale";

// 30 October 2026 — the frame every owner report time series shares.
//
// The charts are server-rendered SVG with NO viewBox: the SVG is sized
// in CSS pixels, so an axis label is the same size on a 320px phone and
// on a 1280px desktop. A scaled viewBox would shrink the numbers on a
// narrow screen until they stopped being readable, which is the defect
// this frame replaces.
//
// Two SVG facts shape the code below:
//
//   * a polyline's `points` are numeric coordinate pairs — percentages
//     are not allowed there, and Chrome drops such a line without a
//     word. A trend is therefore drawn as adjacent <line> elements,
//     whose x1/x2 DO accept percentages;
//   * x1/x2 are not CSS properties, so their value cannot be a calc()
//     expression. The vertical gutter is therefore a percentage of the
//     plot, and the labels sit on the same percentage, so the numbers
//     always touch the axis they name.
//
// The text is the repo's own small-text scale (11px on a phone, 12px
// above it) so the axis reads like the rest of the card.

export const CHART_FRAME_HEIGHT = 132;
export const CHART_PLOT_TOP = 18;
export const CHART_PLOT_HEIGHT = 84;
export const CHART_PLOT_BOTTOM = CHART_PLOT_TOP + CHART_PLOT_HEIGHT;
export const CHART_X_LABEL_BASELINE = 116;
export const CHART_X_TITLE_BASELINE = 129;
/** The plot's left edge, as a percentage of the SVG's width. */
export const CHART_GUTTER_PCT = 13;
/** The plot's right edge, as a percentage of the SVG's width. */
export const CHART_RIGHT_PCT = 99;
/** The gap between the value labels and the plot they belong to. */
export const CHART_LABEL_GAP_PCT = 1.5;

export type ChartYTick = { value: number; label: string; y: number };
export type ChartXTick = {
  label: string;
  xPct: number;
  anchor: "start" | "middle" | "end";
};

/** A position inside the plot, as a percentage of the SVG's width. */
export function chartXPct(fraction: number): number {
  return (
    CHART_GUTTER_PCT + fraction * (CHART_RIGHT_PCT - CHART_GUTTER_PCT)
  );
}

/**
 * Sparse date ticks along the bottom of the plot: the first day, evenly
 * spaced days and the last day, each anchored so a label never runs
 * outside the plot.
 */
export function chartDateTicks(
  labels: string[],
  fractions: number[],
  maxLabels = 4,
): ChartXTick[] {
  const indices = chartTickIndices(labels.length, maxLabels);
  return indices.map((index, order) => ({
    label: chartDateLabel(labels[index] ?? ""),
    xPct: chartXPct(fractions[index] ?? 0),
    anchor:
      indices.length === 1
        ? "middle"
        : order === 0
          ? "start"
          : order === indices.length - 1
            ? "end"
            : "middle",
  }));
}

export function ChartFrame({
  ariaLabel,
  yTicks,
  xTicks,
  valueTitle,
  timeTitle,
  children,
}: {
  ariaLabel: string;
  yTicks: ChartYTick[];
  xTicks: ChartXTick[];
  valueTitle?: string;
  timeTitle?: string;
  children: ReactNode;
}) {
  const labelX = CHART_GUTTER_PCT - CHART_LABEL_GAP_PCT;
  return (
    <svg
      width="100%"
      height={CHART_FRAME_HEIGHT}
      role="img"
      aria-label={ariaLabel}
      className="block w-full overflow-visible"
    >
      <title>{ariaLabel}</title>
      {valueTitle ? (
        <text
          x={`${CHART_GUTTER_PCT}%`}
          y={11}
          fontSize={12}
          className="fill-ink-3 text-[11px] sm:text-[12px]"
        >
          {valueTitle}
        </text>
      ) : null}
      {yTicks.map((tick) => (
        <text
          key={tick.value}
          x={`${labelX}%`}
          y={tick.y + 4}
          textAnchor="end"
          fontSize={12}
          className="fill-ink-3 text-[11px] sm:text-[12px]"
        >
          {tick.label}
        </text>
      ))}
      {yTicks.map((tick) => (
        <line
          key={`grid-${tick.value}`}
          x1={`${CHART_GUTTER_PCT}%`}
          x2={`${CHART_RIGHT_PCT}%`}
          y1={tick.y}
          y2={tick.y}
          className="stroke-line"
          strokeWidth={1}
        />
      ))}
      {children}
      {xTicks.map((tick, index) => (
        <text
          key={`${tick.label}-${index}`}
          x={`${tick.xPct}%`}
          y={CHART_X_LABEL_BASELINE}
          textAnchor={tick.anchor}
          fontSize={12}
          className="fill-ink-3 text-[11px] sm:text-[12px]"
        >
          {tick.label}
        </text>
      ))}
      {timeTitle ? (
        <text
          x={`${CHART_GUTTER_PCT}%`}
          y={CHART_X_TITLE_BASELINE}
          fontSize={12}
          className="fill-ink-3 text-[11px] sm:text-[12px]"
        >
          {timeTitle}
        </text>
      ) : null}
    </svg>
  );
}
