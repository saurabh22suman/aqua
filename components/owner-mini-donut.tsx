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

/** The ring's radius, in the SVG's own user units. */
export const MINI_DONUT_RADIUS = 42;
/** The ring's stroke width, in the same units. */
export const MINI_DONUT_STROKE = 16;
const LABEL_FONT_SIZE = 16;

/**
 * The most characters the ring's hole can hold.
 *
 * The hole is the circle inside the ring — 68 of the SVG's 110 user
 * units — and the label's own box has to sit inside it, its corners
 * included. Six characters fit with air to spare; a longer label is
 * rendered next to the ring instead, where the exact amount stays
 * readable in full.
 *
 * This is a conservative policy, not a width formula: no glyph width
 * is guessed. The rendered probe (home-donut-hole-containment.ts)
 * measures the real label box against the real inner circle and is
 * the authority on the boundary.
 */
export const MINI_DONUT_MAX_LABEL_CHARS = 6;

/** Whether the centre label fits the hole. */
export function miniDonutLabelFits(text: string): boolean {
  return text.length <= MINI_DONUT_MAX_LABEL_CHARS;
}

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

  const radius = MINI_DONUT_RADIUS;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const label = formatINRCompact(totalPaise);
  const labelInCentre = miniDonutLabelFits(label);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        data-testid="owner-mini-donut"
        data-kind="donut"
        role="img"
        aria-label={ariaLabel}
        viewBox="0 0 110 110"
        className="h-[104px] w-[104px] flex-none"
      >
        <g transform="translate(55,55) rotate(-90)">
          <circle r={radius} fill="none" stroke={LINE} strokeWidth={MINI_DONUT_STROKE} />
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
                strokeWidth={MINI_DONUT_STROKE}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return element;
          })}
        </g>
        {labelInCentre ? (
          <text
            x="55"
            y="52"
            textAnchor="middle"
            fontSize={LABEL_FONT_SIZE}
            fontWeight="600"
            fill="var(--color-ink)"
          >
            {label}
          </text>
        ) : null}
        <text x="55" y={labelInCentre ? 69 : 59} textAnchor="middle" fontSize="11" fill="var(--color-ink-3)">
          collected
        </text>
      </svg>
      {labelInCentre ? null : (
        <p
          data-testid="owner-mini-donut-amount"
          className="text-[13px] font-semibold tabular-nums text-ink"
        >
          {label}
        </p>
      )}
    </div>
  );
}
