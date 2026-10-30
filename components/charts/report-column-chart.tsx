import {
  CHART_GUTTER_PCT,
  CHART_PLOT_BOTTOM,
  CHART_PLOT_HEIGHT,
  CHART_RIGHT_PCT,
  ChartFrame,
  chartDateTicks,
  chartXPct,
  type ChartXTick,
  type ChartYTick,
} from "./report-chart-frame";
import {
  chartBarCentres,
  chartNiceTicks,
  type ChartPoint,
} from "./report-chart-scale";

// 30 October 2026 — the collections column chart.
//
// The bars used to sit on a bare baseline with no dates and no money
// scale. They now share the frame of every other time series: a zero
// based money axis and a date axis.
//
// The money rules are unchanged and are the point of this chart. The
// values are whole paise; the axis ticks are whole paise as well
// (chartNiceTicks only ever returns integers), so the label formatter
// receives a value it can format exactly. Nothing here adds, removes
// or rounds a rupee: the exact amounts stay in the card's data table.

export function ColumnChart({
  points,
  ariaLabel,
  valueLabel,
  axisValueLabel,
  valueTitle,
  timeTitle = "Date",
}: {
  points: ChartPoint[];
  ariaLabel: string;
  valueLabel?: (value: number) => string;
  axisValueLabel?: (value: number) => string;
  valueTitle?: string;
  timeTitle?: string;
}) {
  const values = points.map((point) => point.value ?? 0);
  const dataMax = values.length > 0 ? Math.max(...values) : 0;
  const tickValues = chartNiceTicks(dataMax);
  const scaleMax = Math.max(1, tickValues[tickValues.length - 1] ?? 1);
  const centres = chartBarCentres(points.length);
  const format =
    axisValueLabel ?? valueLabel ?? ((value: number) => String(value));

  const yOf = (value: number) =>
    CHART_PLOT_BOTTOM - (value / scaleMax) * CHART_PLOT_HEIGHT;

  const yTicks: ChartYTick[] = tickValues.map((value) => ({
    value,
    label: format(value),
    y: yOf(value),
  }));
  const xTicks: ChartXTick[] = chartDateTicks(
    points.map((point) => point.label),
    centres,
  );

  const slotPct = (CHART_RIGHT_PCT - CHART_GUTTER_PCT) / points.length;
  const barPct = slotPct * 0.86;

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      yTicks={yTicks}
      xTicks={xTicks}
      valueTitle={valueTitle}
      timeTitle={timeTitle}
    >
      {points.map((point, index) => {
        const value = point.value ?? 0;
        const barHeight = (value / scaleMax) * CHART_PLOT_HEIGHT;
        const barHeightPx = Math.max(barHeight, value > 0 ? 2 : 0);
        const centre = chartXPct(centres[index] ?? 0);
        return (
          <rect
            key={`${point.label}-${index}`}
            x={`${centre - barPct / 2}%`}
            y={CHART_PLOT_BOTTOM - barHeightPx}
            width={`${barPct}%`}
            height={barHeightPx}
            rx="3"
            className={value > 0 ? "fill-water" : "fill-deck"}
          >
            <title>{`${point.hint ?? point.label}: ${
              valueLabel ? valueLabel(value) : value
            }`}</title>
          </rect>
        );
      })}
    </ChartFrame>
  );
}
