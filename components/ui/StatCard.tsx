import Link from "next/link";
import type { ReactNode } from "react";

// PR3-C2 — the KPI tile. `kpi` is the shared display-face figure
// treatment (PR3-C1); the delta is shown only when it is real
// (callers pass null rather than inventing a comparison).
export function StatCard({
  label,
  value,
  hint,
  delta,
  href,
  tone = "deck",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  delta?: { direction: "up" | "down" | "flat"; text: string } | null;
  href?: string;
  tone?: "deck" | "paper";
}) {
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-ink-3">{label}</p>
        {delta ? (
          <span
            className={`text-[11.5px] font-medium ${
              delta.direction === "up"
                ? "text-good"
                : delta.direction === "down"
                  ? "text-late"
                  : "text-ink-3"
            }`}
          >
            {delta.text}
          </span>
        ) : null}
      </div>
      <p className="kpi mt-1 text-[22px] font-semibold leading-none">{value}</p>
      {hint ? <p className="mt-1 text-[12px] text-ink-3">{hint}</p> : null}
    </>
  );

  const className = `block rounded-ctl px-3.5 py-3 ${
    tone === "deck" ? "bg-deck" : "bg-paper border border-line"
  }`;
  return href ? (
    <Link href={href} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}
