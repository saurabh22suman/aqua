import {
  CHART_PLOT_BOTTOM,
  CHART_PLOT_HEIGHT,
  ChartFrame,
  chartDateTicks,
  chartXPct,
  type ChartXTick,
  type ChartYTick,
} from "./report-chart-frame";
import {
  chartFractions,
  chartNiceTicks,
  chartPercentTicks,
  chartRuns,
  type ChartPoint,
} from "./report-chart-scale";

// 30 October 2026 — the attendance trend line.
//
// What changed and why: the old line drew a path, a dot and a baseline
// and nothing else, so the owner could not tell which day a point
// belonged to, what the vertical scale was, or how high a point was in
// percent. The line now sits in a real frame: a zero-based percentage
// axis, a date axis, and a gap wherever a day has no recorded mark.
//
// Two rules survive from the old implementation and get stricter:
//
//   * a day with no mark is unknown, not zero. The line stops at the
//     gap and starts again after it; it never joins two days that have
//     no mark between them;
//   * the scale starts at zero, so a 10 point move looks like a 10
//     point move.
//
// The line is drawn as adjacent <line> elements rather than one
// polyline: a polyline's points are numeric coordinate pairs, and the
// percentage points this chart needs are not allowed there — Chrome
// dropped the whole line while the dots and the table still passed
// (evidence/chart-geometry-chrome.json).

export function LineTrend({
  points,
  ariaLabel,
  maxValue,
  formatValue,
  valueTitle,
  timeTitle = "Date",
}: {
  points: ChartPoint[];
  ariaLabel: string;
  maxValue?: number;
  formatValue?: (value: number) => string;
  valueTitle?: string;
  timeTitle?: string;
}) {
  const values = points.map((point) => point.value);
  const recorded = values.filter((value): value is number => value !== null);
  const dataMax = recorded.length > 0 ? Math.max(...recorded) : 0;
  const tickValues =
    maxValue !== undefined ? chartPercentTicks(maxValue) : chartNiceTicks(dataMax);
  const scaleMax = Math.max(1, tickValues[tickValues.length - 1] ?? 1);
  const fractions = chartFractions(points.length);
  const format = formatValue ?? ((value: number) => String(value));

  const yOf = (value: number) =>
    CHART_PLOT_BOTTOM - (value / scaleMax) * CHART_PLOT_HEIGHT;

  const yTicks: ChartYTick[] = tickValues.map((value) => ({
    value,
    label: format(value),
    y: yOf(value),
  }));
  const xTicks: ChartXTick[] = chartDateTicks(
    points.map((point) => point.label),
    fractions,
  );

  const runs = chartRuns(values);

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      yTicks={yTicks}
      xTicks={xTicks}
      valueTitle={valueTitle}
      timeTitle={timeTitle}
    >
      {runs.map((run) =>
        run.slice(0, -1).map((index, runPosition) => {
          // `index` is the day's place in the whole series; the NEXT
          // day of this run is the next entry of the RUN, not the next
          // entry of the series. Reading run[index + 1] mixes the two
          // and sends every segment of a run that starts later than the
          // first day to the baseline.
          const next = run[runPosition + 1]!;
          return (
            <line
              key={`${index}-${next}`}
              x1={`${chartXPct(fractions[index] ?? 0)}%`}
              x2={`${chartXPct(fractions[next] ?? 0)}%`}
              y1={yOf(values[index] ?? 0)}
              y2={yOf(values[next] ?? 0)}
              className="stroke-water"
              strokeWidth={2.5}
            />
          );
        }),
      )}
      {points.map((point, index) =>
        point.value === null ? null : (
          <circle
            key={`${point.label}-${index}`}
            cx={`${chartXPct(fractions[index] ?? 0)}%`}
            cy={yOf(point.value)}
            r={3}
            className="fill-water"
          >
            <title>{`${point.hint ?? point.label}: ${point.value}`}</title>
          </circle>
        ),
      )}
    </ChartFrame>
  );
}
