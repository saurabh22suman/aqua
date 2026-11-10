// 30 October 2026 — the member mix ring.
//
// The bug this file fixes: the arcs used to carry BOTH a CSS
// transform-origin and an SVG `transform="rotate(-90 66 66)"`. The
// browser applies the CSS origin around the whole transform list, so
// the ring was rotated about (132,132) instead of about the circle's
// own centre (66,66) and every arc was pushed 132px down, out of the
// viewBox. The member mix rendered as an empty circle next to a legend
// that said 32 active, 5 paused, 3 lapsed. Root captured the RED in
// Chrome: the transformed centre was (66,198) against an expected
// (66,66).
//
// The fix is the smallest one that keeps the drawing exactly as it was
// drawn: the SVG rotation stays (it is what puts the first slice at
// 12 o'clock) and the dash offsets stay (one slice after another, from
// 3 o'clock along the path). Only the CSS origin goes, because it was
// the thing that moved the rotation's centre. The totals, the status
// colours and the legend are untouched.

export type DonutSlice = { label: string; value: number; tone: string };

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
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = slices
    .filter((slice) => slice.value > 0)
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
          className={slice.tone}
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
