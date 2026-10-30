import Link from "next/link";
import { OwnerHomeActions } from "@/components/owner-home/owner-home-actions";
import { formatINRCompact } from "@/lib/money/format";
import type { OwnerDashboardData } from "@/lib/services/dashboard";

// Owner Home — the reference money block.
//
// ONE tinted surface carries the collection decision:
//   - the collected-today figure dominates;
//   - outstanding and overdue are the supporting balance pair;
//   - the ONE dominant action (Collect payment) lives inside it;
//   - active members / batches / today's sessions stay compact context.
//
// The figures are the existing dashboard read model — bigint paise and
// captured payments only. Nothing here recomputes money or invents a
// period. Overdue ink is late only when money is actually past due.
export function OwnerHomeMoney({
  money,
  context,
  collectedHref,
  collectHref,
  addMemberHref,
  captureEnquiryHref,
  memberLabel,
  enquiryLabel,
}: {
  money: OwnerDashboardData["money"];
  context: {
    activeMemberCount: number;
    activeBatchCount: number;
    sessionCount: number;
    membersLabel: string;
    batchesLabel: string;
    sessionsLabel: string;
  };
  /** Day-level ledger drilldown for the collected figure; permission-gated. */
  collectedHref?: string | null;
  collectHref: string | null;
  addMemberHref: string | null;
  captureEnquiryHref: string | null;
  memberLabel: string;
  enquiryLabel: string;
}) {
  const hasOverdue = money.overdueInvoiceCount > 0;
  const payments = money.collectedTodayCount;

  return (
    <section
      data-testid="owner-home-money-surface"
      aria-label="Collected today"
      className="rounded-card bg-[var(--surface-owner-money)] p-4 lg:p-5"
    >
      <p className="text-[13px] font-medium text-ink-2">Collected today</p>
      {collectedHref ? (
        <Link
          href={collectedHref}
          aria-label="Collected today — view today's transactions"
          className="mt-1 inline-flex min-h-11 items-center font-display text-[36px] font-semibold leading-[1.15] tracking-[-1px] tabular-nums text-ink underline-offset-4 hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <span data-testid="owner-home-money-surface-figure">
            {formatINRCompact(money.collectedTodayPaise)}
          </span>
        </Link>
      ) : (
        <p
          data-testid="owner-home-money-surface-figure"
          className="mt-1 font-display text-[36px] font-semibold leading-[1.15] tracking-[-1px] tabular-nums text-ink"
        >
          {formatINRCompact(money.collectedTodayPaise)}
        </p>
      )}
      <p className="mt-1 text-[12px] text-ink-3">
        {payments === 0
          ? "No payments recorded today yet"
          : `${payments} payment${payments === 1 ? "" : "s"} recorded today`}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        <div className="min-w-0 flex-1 basis-[calc(50%-1rem)] lg:flex-none">
          <p className="text-[12px] text-ink-3">Outstanding now</p>
          <p className="mt-0.5 text-[16px] font-semibold tabular-nums">
            {formatINRCompact(money.outstandingPaise)}
          </p>
          <p className="text-[12px] text-ink-3">
            {money.dueInvoiceCount} invoice{money.dueInvoiceCount === 1 ? "" : "s"} open
          </p>
        </div>
        <div className="min-w-0 flex-1 basis-[calc(50%-1rem)] lg:flex-none">
          <p className="text-[12px] text-ink-3">Overdue now</p>
          <p
            className={`mt-0.5 text-[16px] font-semibold tabular-nums ${
              hasOverdue ? "text-late" : ""
            }`}
          >
            {formatINRCompact(money.overduePaise)}
          </p>
          <p className="text-[12px] text-ink-3">
            {hasOverdue
              ? `Included in outstanding · ${money.overdueInvoiceCount} invoice${
                  money.overdueInvoiceCount === 1 ? "" : "s"
                } past due${
                  money.oldestOverdueDays !== null
                    ? ` · oldest ${money.oldestOverdueDays} day${
                        money.oldestOverdueDays === 1 ? "" : "s"
                      }`
                    : ""
                }`
              : "Nothing past due · no overdue balance included"}
          </p>
        </div>
      </div>

      <OwnerHomeActions
        collectHref={collectHref}
        addMemberHref={addMemberHref}
        captureEnquiryHref={captureEnquiryHref}
        memberLabel={memberLabel}
        enquiryLabel={enquiryLabel}
      />

      <p
        data-testid="owner-home-compact-summary-desktop"
        className="mt-3 hidden border-t border-line pt-2.5 text-[12px] text-ink-3 lg:block"
      >
        {context.activeMemberCount} active {context.membersLabel} ·{" "}
        {context.activeBatchCount} {context.batchesLabel} · {context.sessionCount}{" "}
        {context.sessionsLabel} today
      </p>
    </section>
  );
}
