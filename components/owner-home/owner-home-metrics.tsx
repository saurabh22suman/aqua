import { StatCard, type StatCardIcon, type StatCardTone } from "@/components/ui/StatCard";
import type { ReactNode } from "react";

// Owner Home — the summary figures.
//
// Four figures on a desktop. On a phone only the TWO money figures
// stay as cards, and the member and session counts collapse into one
// quiet line underneath them — the numbers are still there, they are
// just not four boxes on a 390px screen.
//
// The cards are the shared StatCard primitive: the surface carries no
// meaning, the icon chip carries the state, and the words carry the
// rest. A calm figure is never dressed as an alarm.
export type OwnerMetricCard = {
  key: string;
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  tone: StatCardTone;
  icon: StatCardIcon;
  /**
   * True for the figures a phone shows as a compact line instead of a
   * card. The card is still in the document — it is only hidden from
   * the phone layout, and the same numbers are in the summary line.
   */
  compactOnly?: boolean;
};

export function OwnerHomeMetrics({
  cards,
  compactSummary,
}: {
  cards: OwnerMetricCard[];
  /** The compact phone line: the real member and session counts. */
  compactSummary: string;
}) {
  return (
    <>
      <div
        data-testid="owner-home-metrics"
        // Four across once there is room for them (1180px and up —
        // the approved board is a 1280 layout, and a 1280 window with
        // a scrollbar is 1265 CSS pixels wide); a 2×2 block between
        // the shell breakpoint and that, and the two money figures
        // only on a phone.
        className="mt-5 grid grid-cols-2 gap-2.5 wide:grid-cols-4"
      >
        {cards.map((card) =>
          card.compactOnly ? (
            // `lg:contents` makes the card a grid item of its own from
            // the shell breakpoint up, so the four cards line up in one
            // row once there is room; below lg the wrapper is hidden
            // and the card's numbers live in the compact line
            // underneath.
            <div key={card.key} className="hidden lg:contents">
              <StatCard
                label={card.label}
                value={card.value}
                hint={card.hint}
                href={card.href}
                tone={card.tone}
                icon={card.icon}
              />
            </div>
          ) : (
            <StatCard
              key={card.key}
              label={card.label}
              value={card.value}
              hint={card.hint}
              href={card.href}
              tone={card.tone}
              icon={card.icon}
            />
          ),
        )}
      </div>
      <p
        data-testid="owner-home-compact-summary"
        className="mt-2.5 text-[12px] text-ink-3 lg:hidden"
      >
        {compactSummary}
      </p>
    </>
  );
}
