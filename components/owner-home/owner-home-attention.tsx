import Link from "next/link";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { CountChip } from "@/components/ui/CountChip";
import type { ReactNode } from "react";

// Owner Home — the attention queue.
//
// The approved board calls it "A little attention": a short list of
// the things that actually need the owner, each one stating a REASON
// and where it can be dealt with.
//
// Two rules the queue keeps:
//
//   * it is in the order the service produced, which is the priority
//     order (a cash discrepancy first, then the billing decision, then
//     the follow-ups, then the register);
//   * nothing is hidden. The rows that do not fit are one disclosure
//     away, and a MONEY-late row is never the one that gets folded
//     away — a critical item the owner cannot see is worse than a
//     slightly longer list.
//
// The panel's own surface is a soft tint, and the rows are flat rows
// on it — not cards inside a card.
export type OwnerAttentionRow = {
  title: string;
  detail: string;
  href?: string;
  /**
   * The tone of the row's icon chip. The CLASS for the tone is chosen
   * by the caller, because the reserved money/attention tokens are
   * only allowed in the files the semantic-token rule sanctions.
   */
  tone: "warn" | "late";
  iconClassName: string;
};

export function OwnerHomeAttention({
  rows,
  hiddenRows = [],
  count,
  summary,
  onEmpty,
}: {
  rows: readonly OwnerAttentionRow[];
  /**
   * The rows that do not fit on the panel. They stay REACHABLE — one
   * disclosure away — and the disclosure says how many they are.
   */
  hiddenRows?: readonly OwnerAttentionRow[];
  /** The true total — every item, not only the ones on screen. */
  count: number;
  /** The line under the heading. */
  summary: string;
  /** What the panel says when nothing needs attention. */
  onEmpty?: ReactNode;
}) {
  return (
    <section
      data-testid="owner-home-attention"
      aria-label="Needs your attention"
      className="overflow-hidden rounded-card border border-[var(--surface-attention-border)] bg-[var(--surface-attention)]"
    >
      <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0">
          <h2 className="font-display text-[16px] font-semibold">A little attention</h2>
          <p className="mt-0.5 text-[12px] text-ink-3">{summary}</p>
        </div>
        {count > 0 ? <CountChip count={count} tone="warn" /> : null}
      </div>

      {rows.length === 0 && hiddenRows.length === 0 ? (
        <div className="px-4 pb-4">
          <p className="text-[13.5px] font-medium">
            Nothing needs attention right now.
          </p>
          {onEmpty}
        </div>
      ) : (
        <>
          <ul>
            {rows.map((row, index) => (
              <AttentionListItem
                key={`${row.title}-${index}`}
                row={row}
                divided={index > 0}
              />
            ))}
          </ul>
          {hiddenRows.length > 0 ? (
            <details className="border-t border-[var(--surface-attention-border)]">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 px-4 text-[13px] font-medium text-ink-2 marker:content-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
                {hiddenRows.length} more need attention
              </summary>
              <ul>
                {hiddenRows.map((row, index) => (
                  <AttentionListItem
                    key={`${row.title}-hidden-${index}`}
                    row={row}
                    divided
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

/** One attention row: a chip, a reason, and where it can be dealt with. */
function AttentionListItem({
  row,
  divided,
}: {
  row: OwnerAttentionRow;
  divided: boolean;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={`grid h-9 w-9 flex-none place-items-center rounded-[11px] ${row.iconClassName}`}
      >
        <TriangleAlert size={16} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium leading-tight">
          {row.title}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
          {row.detail}
        </span>
      </span>
      {row.href ? (
        <ChevronRight size={18} className="flex-none text-ink-3" aria-hidden="true" />
      ) : null}
    </>
  );
  const classes =
    "flex items-start gap-3 px-4 py-3 motion-fast transition-colors hover:bg-paper/60";
  return (
    <li className={divided ? "border-t border-[var(--surface-attention-border)]" : ""}>
      {row.href ? (
        <Link href={row.href} className={classes}>
          {body}
        </Link>
      ) : (
        <div className={classes}>{body}</div>
      )}
    </li>
  );
}
