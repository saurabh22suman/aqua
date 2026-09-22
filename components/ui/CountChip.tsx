// PR3-C2 — small count pill. Used beside section headers ("3 lapsed")
// so a count is never restyled per screen.
export function CountChip({
  count,
  label,
  tone = "neutral",
}: {
  count: number;
  label?: string;
  tone?: "neutral" | "warn" | "late";
}) {
  const toneClass =
    tone === "warn"
      ? "bg-warn-soft text-warn"
      : tone === "late"
        ? "bg-late-soft text-late"
        : "bg-deck text-ink-2";
  return (
    <span
      className={`inline-flex flex-none items-center gap-1 rounded-pill px-2.5 py-1 text-[11.5px] font-medium tabular-nums ${toneClass}`}
      data-testid="count-chip"
    >
      {count}
      {label ? <span className="font-normal">{` ${label}`}</span> : null}
    </span>
  );
}
