// PR3-C2 — progress bar. One fill primitive so lane strips, runway
// strips and dashboard meters agree on height, radius and tone.
export type ProgressTone = "water" | "warn" | "late" | "good";

const TONE_CLASS: Record<ProgressTone, string> = {
  water: "bg-water",
  warn: "bg-warn",
  late: "bg-late",
  good: "bg-good",
};

export function ProgressBar({
  value,
  max,
  tone = "water",
  label,
  className = "",
}: {
  value: number;
  max: number;
  tone?: ProgressTone;
  label?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0;
  return (
    <div
      className={`h-1.5 rounded-pill bg-deck overflow-hidden ${className}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div
        className={`h-full rounded-pill transition-[width] duration-300 ${TONE_CLASS[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
