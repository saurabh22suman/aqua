import { formatDateIST } from "@/lib/time/tz";

// 30 October 2026 — the arithmetic behind the owner report charts.
//
// These are pure functions on purpose: the axes, the gaps and the money
// ticks are the parts a reader checks, so they must be decidable
// without a browser and without a card around them.
//
// Two rules run through the file:
//
//   * a day with no recorded mark is UNKNOWN, never zero. A null breaks
//     the line instead of being drawn as a zero point, so a gap in the
//     data reads as a gap on the chart;
//   * money stays whole paise. The tick helper returns integers only,
//     because the money formatter refuses a fractional paise value and
//     a fractional tick would throw at render time.

export type ChartPoint = {
  label: string;
  value: number | null;
  hint?: string;
};

/**
 * The contiguous runs of recorded points. A null ends the run, so the
 * chart draws one line per run and never joins two days that have no
 * mark between them.
 */
export function chartRuns(values: Array<number | null>): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) {
        runs.push(current);
        current = [];
      }
      return;
    }
    current.push(index);
  });
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * "2026-09-01" -> "1 Sept". The wording is the app's own IST date
 * format with the year dropped, so an axis tick and the table below it
 * never disagree about the same day.
 */
export function chartDateLabel(label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  return formatDateIST(label).replace(/\s+\d{4}$/, "");
}

/**
 * Where each point sits inside the plot, as a fraction between 0 and 1.
 * The caller maps a fraction onto the plot's own percentage range, so
 * the numbers never have to know how wide the card is.
 */
export function chartFractions(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0.5];
  return Array.from({ length: count }, (_, index) => index / (count - 1));
}

/**
 * The centre of each column, as a fraction of the plot. A column chart
 * spaces its bars across the whole plot, so a bar's centre sits in the
 * middle of its slot and its date label sits on the same spot.
 */
export function chartBarCentres(count: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => (index + 0.5) / count);
}

/**
 * Sparse tick indices: every point when there are few, otherwise evenly
 * spaced ones that always include the first and the last day.
 */
export function chartTickIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, index) => index);
  const step = (count - 1) / (maxLabels - 1);
  const indices = Array.from({ length: maxLabels }, (_, index) =>
    Math.round(index * step),
  );
  return Array.from(new Set(indices));
}

/**
 * A zero-based axis: whole steps from 0 up to a round maximum that is
 * never below the data. The step is an integer, so a money tick is
 * always whole paise.
 */
export function chartNiceTicks(max: number, count = 4): number[] {
  const top = Math.max(0, Math.floor(max));
  if (top === 0) return [0];
  const raw = top / count;
  const magnitude = Math.max(1, 10 ** Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;
  const step =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) *
    magnitude;
  const ticks: number[] = [];
  for (let value = 0; value < top + step; value += step) ticks.push(value);
  return ticks;
}

/** The percentage scale of the attendance trend: 0, half, full. */
export function chartPercentTicks(max: number): number[] {
  return [0, max / 2, max];
}
