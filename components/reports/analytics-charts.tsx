import { formatINR } from "@/lib/money/format";

// U-01 — inline SVG charts. No charting dependency: these are plain
// server-rendered SVG built from the design tokens (water for data,
// deck for tracks, line for rules). Colour here is data, never
// decoration, per DESIGN.md's thesis.
//
// Every chart tolerates a single point and an empty series; the card
// wrappers own the honest empty state copy, these primitives simply
// never invent a point.

const W = 320;

export type ChartPoint = {
  label: string;
  value: number | null;
  hint?: string;
};

export function LineTrend({
  points,
  ariaLabel,
  maxValue,
}: {
  points: ChartPoint[];
  ariaLabel: string;
  maxValue?: number;
}) {
  const height = 120;
  const pad = 8;
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const max = Math.max(1, maxValue ?? 0, ...values);
  const stepX = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);

  const path = points
    .map((p, i) =>
      p.value === null ? null : `${i === 0 ? "M" : "L"} ${pad + i * stepX} ${y(p.value)}`,
    )
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${W} ${height}`}
      className="w-full"
    >
      <title>{ariaLabel}</title>
      <line
        x1={pad}
        y1={height - pad}
        x2={W - pad}
        y2={height - pad}
        className="stroke-line"
        strokeWidth="1"
      />
      {path ? (
        <path d={path} fill="none" className="stroke-water" strokeWidth="2.5" />
      ) : null}
      {points.map((p, i) =>
        p.value === null ? null : (
          <circle
            key={`${p.label}-${i}`}
            cx={pad + i * stepX}
            cy={y(p.value)}
            r="3"
            className="fill-water"
          >
            <title>{`${p.hint ?? p.label}: ${p.value}`}</title>
          </circle>
        ),
      )}
    </svg>
  );
}

export function ColumnChart({
  points,
  ariaLabel,
  valueLabel,
}: {
  points: ChartPoint[];
  ariaLabel: string;
  valueLabel?: (value: number) => string;
}) {
  const height = 120;
  const pad = 8;
  const gap = 4;
  const values = points.map((p) => p.value ?? 0);
  const max = Math.max(1, ...values);
  const slot = points.length > 0 ? (W - pad * 2) / points.length : W;
  const barWidth = Math.max(4, slot - gap);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${W} ${height}`}
      className="w-full"
    >
      <title>{ariaLabel}</title>
      <line
        x1={pad}
        y1={height - pad}
        x2={W - pad}
        y2={height - pad}
        className="stroke-line"
        strokeWidth="1"
      />
      {points.map((p, i) => {
        const value = p.value ?? 0;
        const barHeight = (value / max) * (height - pad * 2);
        return (
          <rect
            key={`${p.label}-${i}`}
            x={pad + i * slot + gap / 2}
            y={height - pad - barHeight}
            width={barWidth}
            height={Math.max(barHeight, value > 0 ? 2 : 0)}
            rx="3"
            className={value > 0 ? "fill-water" : "fill-deck"}
          >
            <title>{`${p.hint ?? p.label}: ${
              valueLabel ? valueLabel(value) : value
            }`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function HorizontalBars({
  rows,
  ariaLabel,
}: {
  rows: Array<{ label: string; value: number; hint?: string }>;
  ariaLabel: string;
}) {
  const rowHeight = 28;
  const height = Math.max(rowHeight, rows.length * rowHeight + 8);
  const labelWidth = 96;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const trackWidth = W - labelWidth - 12;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${W} ${height}`}
      className="w-full"
    >
      <title>{ariaLabel}</title>
      {rows.map((row, i) => {
        const y = 4 + i * rowHeight;
        const width = (row.value / max) * trackWidth;
        return (
          <g key={row.label}>
            <text
              x={0}
              y={y + 12}
              className="fill-ink-3"
              fontSize="11"
            >
              {row.label.length > 18 ? `${row.label.slice(0, 17)}…` : row.label}
            </text>
            <rect
              x={labelWidth}
              y={y + 2}
              width={trackWidth}
              height="10"
              rx="5"
              className="fill-deck"
            />
            <rect
              x={labelWidth}
              y={y + 2}
              width={Math.max(width, row.value > 0 ? 3 : 0)}
              height="10"
              rx="5"
              className="fill-water"
            >
              <title>{`${row.label}: ${row.hint ?? formatINR(row.value)}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

export type DonutSlice = { label: string; value: number; tone: string };

// A single donut for the member mix. `tone` is a closed set of token
// class names (stroke-water / stroke-good / stroke-warn / stroke-late /
// stroke-ink-3); the caller picks from the semantic set — never an
// arbitrary colour.
export function Donut({
  slices,
  ariaLabel,
}: {
  slices: DonutSlice[];
  ariaLabel: string;
}) {
  const size = 132;
  const radius = 52;
  const stroke = 18;
  const center = size / 2;
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = slices
    .filter((s) => s.value > 0)
    .map((slice) => {
      const fraction = slice.value / total;
      const dash = fraction * circumference;
      const arc = (
        <circle
          key={slice.label}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeDashoffset={-offset}
          className={`${slice.tone} origin-center`}
          transform={`rotate(-90 ${center} ${center})`}
        >
          <title>{`${slice.label}: ${slice.value}`}</title>
        </circle>
      );
      offset += dash;
      return arc;
    });

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${size} ${size}`}
      className="h-[132px] w-[132px]"
    >
      <title>{ariaLabel}</title>
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-deck"
      />
      {total > 0 ? arcs : null}
    </svg>
  );
}
