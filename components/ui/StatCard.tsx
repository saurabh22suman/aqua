import Link from "next/link";
import type { ReactNode } from "react";

// PR3-C2 — the KPI tile. `kpi` is the shared display-face figure
// treatment (PR3-C1); the delta is shown only when it is real
// (callers pass null rather than inventing a comparison).
//
// Batch 4 — the tile is a PASTEL surface with a state-coloured icon
// chip, so a row of four figures can be scanned instead of read as four
// identical white cards (the approved direction:
// docs/design-system/references/mint-desktop-direction.png).
//
// Two rules the tile keeps:
//
//   * the SURFACE carries no meaning — it is a pastel. The meaning is
//     carried by the words and by the icon chip, which wears the
//     reserved status tokens (good / late / warn / water / marine).
//   * a calm figure is not dressed as an alarm: the `late` surface is
//     only for money that IS late, so a quiet morning stays calm.
export type StatCardTone =
  | "deck"
  | "paper"
  | "money"
  | "info"
  | "butter"
  | "late";

export type StatCardIcon = {
  node: ReactNode;
  /** The reserved token the chip wears: money and attendance meaning. */
  tone: "good" | "late" | "warn" | "water" | "marine" | "neutral";
};

const SURFACE_CLASS: Record<StatCardTone, string> = {
  deck: "bg-deck",
  paper: "bg-paper border border-line",
  money: "bg-tile-money",
  info: "bg-tile-info",
  butter: "bg-tile-butter",
  late: "bg-late-soft",
};

const CHIP_CLASS: Record<StatCardIcon["tone"], string> = {
  good: "bg-good-soft text-good",
  late: "bg-late-soft text-late",
  warn: "bg-warn-soft text-warn",
  water: "bg-water-soft text-water",
  marine: "bg-marine text-paper",
  neutral: "bg-deck text-ink-2",
};

export function StatCard({
  label,
  value,
  hint,
  delta,
  href,
  icon,
  tone = "deck",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  delta?: { direction: "up" | "down" | "flat"; text: string } | null;
  href?: string;
  icon?: StatCardIcon;
  tone?: StatCardTone;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <span
              data-testid="stat-card-icon"
              aria-hidden="true"
              className={`grid h-8 w-8 flex-none place-items-center rounded-[10px] ${CHIP_CLASS[icon.tone]}`}
            >
              {icon.node}
            </span>
          ) : null}
          <p className="text-[13px] font-medium text-ink-3">{label}</p>
        </div>
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

  const className = `block rounded-ctl px-3.5 py-3 ${SURFACE_CLASS[tone]}`;
  return href ? (
    <Link href={href} className={className} data-testid="stat-card">
      {inner}
    </Link>
  ) : (
    <div className={className} data-testid="stat-card">
      {inner}
    </div>
  );
}
