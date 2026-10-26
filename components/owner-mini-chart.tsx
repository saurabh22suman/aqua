import { formatINRCompact } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";

// Owner Home — the phone trend charts.
//
// DESIGN.md §5: "No chart library on any mobile route. Server-render
// SVG or lazy-load behind interaction." The ECharts island is a lazy
// `lg+` island, so below `lg` the panels had NOTHING but a "View data
// table" disclosure — a phone owner could not see the shape of their
// own month at all.
//
// These charts are plain server-rendered SVG: no engine, no client
// JavaScript, no bundle cost, and they work with JavaScript disabled.
// They carry the same numbers as the desktop island and the same
// accessible data table stays beside them, so the picture is a summary
// and the table is the source (DESIGN.md §3, Charts).
//
// The rules the desktop chart also obeys are kept here:
//   - the same series colours as the desktop chart, so a category has
//     one colour on every surface;
//   - no empty frame: a period with no data renders nothing, and the
//     panel states the honest sentence instead;
//   - unknown is not zero: an attendance bucket with no marks is a
//     GAP in the line, never a point on the baseline;
//   - the units are on the chart (₹ on the bars, % on the line), and
//     the axis states which range is drawn;
//   - nothing is smaller than the 11px floor (DESIGN.md §1.3).

export type MiniBarBucket = {
  label: string;
  fullLabel: string;
  cash: number;
  digital: number;
  other: number;
  total: number;
};

export type MiniLineBucket = {
  label: string;
  fullLabel: string;
  pct: number | null;
};

// The chart canvas. The viewBox is the drawing coordinate system; the
// SVG scales to the panel width, so the same numbers draw at 320px on
// a phone and inside a wider panel.
const W = 320;
const PLOT = 112;
const H = PLOT + 18;
const AXIS = PLOT + 13;

const CASH = "var(--chart-1)";
const DIGITAL = "var(--chart-2)";
const OTHER = "var(--chart-3)";
const ATTENDANCE = "var(--chart-2)";
const LINE = "var(--color-line)";

/**
 * The axis captions: the first, middle and last bucket. A day bucket
 * carries an hour ("2026-10-26 15:00"), a week or month bucket a
 * calendar date — each is printed the way a person reads it.
 */
function axisLabels(buckets: { label: string; fullLabel: string }[]) {
  const readable = (bucket: { label: string; fullLabel: string }) => {
    // An hour bucket ("2026-10-26 15:00") reads as its hour label.
    if (/\d{2}:\d{2}$/.test(bucket.fullLabel)) return bucket.label;
    // A calendar bucket ("2026-10-01") is formatted for a person.
    if (/^\d{4}-\d{2}-\d{2}$/.test(bucket.fullLabel)) return formatDateIST(bucket.fullLabel);
    // A week or month bucket already carries a readable date.
    return bucket.fullLabel;
  };
  const first = buckets[0];
  const middle = buckets[Math.floor((buckets.length - 1) / 2)];
  const last = buckets[buckets.length - 1];
  if (!first || !middle || !last) return null;
  return { first: readable(first), middle: readable(middle), last: readable(last) };
}

/** The three axis captions, drawn under the plot. */
function Axis({ labels }: { labels: { first: string; middle: string; last: string } }) {
  return (
    <>
      <text x="0" y={AXIS} fontSize="11" fill="var(--color-ink-3)" textAnchor="start">
        {labels.first}
      </text>
      <text x={W / 2} y={AXIS} fontSize="11" fill="var(--color-ink-3)" textAnchor="middle">
        {labels.middle}
      </text>
      <text x={W} y={AXIS} fontSize="11" fill="var(--color-ink-3)" textAnchor="end">
        {labels.last}
      </text>
    </>
  );
}

/**
 * Collections per bucket — the same stacked cash/digital/other bars the
 * desktop island draws, small enough for a phone.
 */
export function MiniBars({
  buckets,
  ariaLabel,
}: {
  buckets: MiniBarBucket[];
  ariaLabel: string;
}) {
  const max = buckets.reduce((top, bucket) => Math.max(top, bucket.total), 0);
  if (max <= 0 || buckets.length === 0) return null;

  const slot = W / buckets.length;
  const barWidth = Math.max(2, Math.min(14, slot - 2));
  const scale = (value: number) => (value / max) * PLOT;
  const axis = axisLabels(buckets);

  return (
    <svg
      data-testid="owner-mini-chart"
      data-kind="bars"
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${W} ${H}`}
      className="h-[128px] w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <line x1="0" y1={PLOT} x2={W} y2={PLOT} stroke={LINE} strokeWidth="1" />
      <text x="0" y="12" fontSize="12" fill="var(--color-ink-3)">
        {formatINRCompact(max)}
      </text>
      {buckets.map((bucket, index) => {
        const x = index * slot + (slot - barWidth) / 2;
        const cashHeight = scale(bucket.cash);
        const digitalHeight = scale(bucket.digital);
        const otherHeight = scale(bucket.other);
        return (
          <g key={`${bucket.label}-${index}`}>
            {cashHeight > 0 ? (
              <rect x={x} y={PLOT - cashHeight} width={barWidth} height={cashHeight} fill={CASH} />
            ) : null}
            {digitalHeight > 0 ? (
              <rect
                x={x}
                y={PLOT - cashHeight - digitalHeight}
                width={barWidth}
                height={digitalHeight}
                fill={DIGITAL}
              />
            ) : null}
            {otherHeight > 0 ? (
              <rect
                x={x}
                y={PLOT - cashHeight - digitalHeight - otherHeight}
                width={barWidth}
                height={otherHeight}
                fill={OTHER}
              />
            ) : null}
          </g>
        );
      })}
      {axis ? <Axis labels={axis} /> : null}
    </svg>
  );
}

/**
 * Attendance percentage per bucket. A bucket with no marks is UNKNOWN:
 * it is a gap in the line, never a point on the baseline.
 */
export function MiniLine({
  buckets,
  ariaLabel,
}: {
  buckets: MiniLineBucket[];
  ariaLabel: string;
}) {
  const known = buckets.filter((bucket) => bucket.pct !== null);
  if (known.length === 0 || buckets.length === 0) return null;

  const slot = W / buckets.length;
  const y = (pct: number) => PLOT - (pct / 100) * PLOT;
  const axis = axisLabels(buckets);

  // One path per run of known buckets, so an unknown bucket breaks the
  // line instead of being interpolated across.
  const runs: MiniLineBucket[][] = [];
  let run: MiniLineBucket[] = [];
  for (const bucket of buckets) {
    if (bucket.pct === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push(bucket);
  }
  if (run.length > 0) runs.push(run);

  return (
    <svg
      data-testid="owner-mini-chart"
      data-kind="line"
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${W} ${H}`}
      className="h-[128px] w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <line x1="0" y1={PLOT} x2={W} y2={PLOT} stroke={LINE} strokeWidth="1" />
      <line
        x1="0"
        y1="0"
        x2={W}
        y2="0"
        stroke={LINE}
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text x="0" y="12" fontSize="12" fill="var(--color-ink-3)">
        100%
      </text>
      <text x="0" y={PLOT - 3} fontSize="11" fill="var(--color-ink-3)">
        0%
      </text>
      {runs.map((segment, runIndex) => (
        <polyline
          key={`run-${runIndex}`}
          fill="none"
          stroke={ATTENDANCE}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={segment
            .map((bucket) => {
              const index = buckets.indexOf(bucket);
              const x = index * slot + slot / 2;
              return `${x},${y(bucket.pct ?? 0)}`;
            })
            .join(" ")}
        />
      ))}
      {known.map((bucket) => {
        const index = buckets.indexOf(bucket);
        const x = index * slot + slot / 2;
        return (
          <circle
            key={`${bucket.label}-${index}`}
            cx={x}
            cy={y(bucket.pct ?? 0)}
            r="2.5"
            fill={ATTENDANCE}
          />
        );
      })}
      {axis ? <Axis labels={axis} /> : null}
    </svg>
  );
}
