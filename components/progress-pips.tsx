// V-11 — the progress pip. One row of four pips; the filled count is
// the band (1-4), no assessment renders as four empty pips plus a
// "Not assessed" label. `water` is the design system's DATA token
// (DESIGN.md §1.1: "charts, capacity, progress") — progress is never a
// money/attendance semantic, which is why this uses no good/late/warn.
//
// Server component: the pip carries its state as markup, so the whole
// progress view stays zero-interaction except the assess taps.

export function ProgressPips({
  band,
  label,
  size = "md",
}: {
  band: number | null;
  label: string;
  size?: "sm" | "md";
}) {
  const filled = band ?? 0;
  const pip = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  return (
    <span
      role="img"
      aria-label={
        band === null ? `${label}: not assessed` : `${label}: band ${band} of 4`
      }
      data-testid="progress-pips"
      data-band={band ?? ""}
      className="inline-flex items-center gap-1"
    >
      {[1, 2, 3, 4].map((step) => {
        const on = step <= filled;
        return (
          <span
            key={step}
            aria-hidden="true"
            data-testid={`pip-${step}`}
            data-filled={on ? "true" : "false"}
            className={`${pip} rounded-full ${
              on ? "bg-water" : "border border-line bg-deck"
            }`}
          />
        );
      })}
    </span>
  );
}
