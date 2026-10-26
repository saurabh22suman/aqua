import { formatINRCompact } from "@/lib/money/format";

// Owner Home — the phone payment-mix ring.
//
// The desktop island draws the doughnut with ECharts; below `lg` the
// same composition is drawn as a stroked SVG ring, so a phone sees the
// mix and not only the numbers (DESIGN.md §3, Charts; §5: no chart
// library on a mobile route).
//
// The centre states the captured total, so the ring never needs a legend
// to be read, and the segments use the same colours as the desktop
// doughnut: one category, one colour on every surface.

const CASH = "var(--chart-1)";
const DIGITAL = "var(--chart-2)";
const OTHER = "var(--chart-3)";
const LINE = "var(--color-line)";

export type MiniSlice = {
  key: string;
  label: string;
  paise: number;
};

export function MiniDonut({
  slices,
  totalPaise,
  ariaLabel,
}: {
  slices: MiniSlice[];
  totalPaise: number;
  ariaLabel: string;
}) {
  if (totalPaise <= 0) return null;

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg
      data-testid="owner-mini-donut"
      data-kind="donut"
      role="img"
      aria-label={ariaLabel}
      viewBox="0 0 110 110"
      className="h-[104px] w-[104px] flex-none"
    >
      <g transform="translate(55,55) rotate(-90)">
        <circle r={radius} fill="none" stroke={LINE} strokeWidth="16" />
        {slices.map((slice) => {
          if (slice.paise <= 0) return null;
          const length = (slice.paise / totalPaise) * circumference;
          const dash = `${length} ${circumference - length}`;
          const element = (
            <circle
              key={slice.key}
              r={radius}
              fill="none"
              stroke={slice.key === "cash" ? CASH : slice.key === "digital" ? DIGITAL : OTHER}
              strokeWidth="16"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return element;
        })}
      </g>
      <text
        x="55"
        y="52"
        textAnchor="middle"
        fontSize="16"
        fontWeight="600"
        fill="var(--color-ink)"
      >
        {formatINRCompact(totalPaise)}
      </text>
      <text x="55" y="69" textAnchor="middle" fontSize="11" fill="var(--color-ink-3)">
        collected
      </text>
    </svg>
  );
}
