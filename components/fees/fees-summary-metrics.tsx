import type { FeesOverview } from "@/lib/services/fees-hub";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { formatINR, formatINRWhole } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { FeesOverviewCards } from "@/components/fees/fees-overview-cards";
import { buttonClasses } from "@/components/ui/Button";

// U-02 — Overview separates two different questions instead of presenting
// four equal tiles: what the applied period collected, and what the club
// is owed right now. Overdue is part of the current outstanding balance,
// so it sits inside that card as a subordinate row, not beside it as a
// competing headline.
export function FeesSummaryMetrics({ overview, facility, period }: { overview: FeesOverview; facility?: string | null; period: { from: string; to: string } }) {
  const scope = `&facility=${facility ?? "all"}`;
  const transactionsHref = `/owner/fees?tab=transactions&from=${period.from}&to=${period.to}${scope}`;
  const outstandingHref = `/owner/fees?tab=dues&from=${period.from}&to=${period.to}${scope}`;
  const overdueHref = `/owner/fees?${new URLSearchParams({
    tab: "dues",
    overdue: "1",
    facility: facility ?? "all",
    from: period.from,
    to: period.to,
  })}`;

  return (
    <section className="mt-4 space-y-3">
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <section
          role="group"
          aria-label="Period collections"
          className="owner-money-kpi"
        >
          <h2 className="font-display text-[16px] font-semibold leading-[1.4] text-ink">
            Period collections
          </h2>
          <p className="mt-3 break-words font-display text-[26px] font-semibold leading-tight tabular-nums text-ink">
            {formatINRWhole(overview.collectedPaise)}
          </p>
          <p className="mt-2 text-[12px] leading-snug text-ink-2">
            {overview.paymentCount} payment
            {overview.paymentCount === 1 ? "" : "s"} captured at the counter
            {overview.reversedPaise > 0
              ? ` · ${formatINR(overview.reversedPaise)} reversed separately (${overview.reversalCount})`
              : ""}
          </p>
          <Link
            href={transactionsHref}
            aria-label="View period transactions"
            className="mt-2 inline-flex min-h-11 items-center text-[12.5px] font-medium text-accent-ink"
          >
            Transactions
          </Link>
        </section>

        <section
          role="group"
          aria-label="Current balances"
          className="owner-money-kpi"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="font-display text-[16px] font-semibold leading-[1.4] text-ink">
              Current balances
            </h2>
            <p className="text-[11.5px] text-ink-3">
              As of {formatDateIST(overview.today)}
            </p>
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            Independent of report dates.
          </p>

          <div className="mt-3">
            <p className="text-[12px] font-medium text-ink-2">Outstanding</p>
            <p className="mt-1 break-words font-display text-[26px] font-semibold leading-tight tabular-nums text-ink">
              {formatINRWhole(overview.outstandingPaise)}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-ink-3">
              {overview.dueInvoiceCount} invoice
              {overview.dueInvoiceCount === 1 ? "" : "s"} with a balance
            </p>
          </div>

          <div className="mt-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-ink-2">Overdue</p>
                <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
                  {overview.overdueInvoiceCount} invoice
                  {overview.overdueInvoiceCount === 1 ? "" : "s"} past the due
                  date
                </p>
              </div>
              <p className="break-words text-[16px] font-semibold leading-tight tabular-nums text-ink">
                {formatINRWhole(overview.overduePaise)}
              </p>
            </div>
          </div>

          {overview.dueInvoiceCount > 0 || overview.overdueInvoiceCount > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {overview.overdueInvoiceCount > 0 ? (
                <Link href={overdueHref} aria-label="View overdue invoices" className={buttonClasses({ size: "sm" })}>
                  Overdue
                </Link>
              ) : null}
              {overview.dueInvoiceCount > 0 ? (
                <Link href={outstandingHref} className={buttonClasses({ size: "sm" })}>
                  All due
                </Link>
              ) : null}
            </div>
          ) : null}

          <details className="mt-2 border-t border-line">
            <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-[var(--accent-ink)]">
              Exact balances
            </summary>
            <dl className="space-y-1 pb-2 text-[13px]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <dt>Outstanding</dt>
                <dd className="tabular-nums">{formatINR(overview.outstandingPaise)}</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <dt>Overdue</dt>
                <dd className="tabular-nums">{formatINR(overview.overduePaise)}</dd>
              </div>
            </dl>
          </details>
        </section>
      </div>

      <FeesOverviewCards overview={overview} facility={facility ?? "all"} from={period.from} to={period.to} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <details className="rounded-card border border-line bg-paper p-4">
          <summary className="cursor-pointer font-medium">Financial evidence</summary>
          <p className="mt-2 text-[13px] text-ink-2">Exact period collections <strong className="tabular-nums">{formatINR(overview.collectedPaise)}</strong></p>
          <ul className="mt-2 divide-y divide-line text-[13px]">
            <li>
              <Link
                href={`/owner/reports/collections?${new URLSearchParams({ facility: facility ?? "all" })}`}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <span>
                  Daily collections
                  <span className="mt-0.5 block text-[12px] text-ink-3">
                    Today’s cash count and method breakdown
                  </span>
                </span>
                <span className="text-[12.5px] text-[var(--accent-ink)]">
                  Open
                </span>
              </Link>
            </li>
            <li>
              <Link
                href={transactionsHref}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <span>
                  Transactions
                  <span className="mt-0.5 block text-[12px] text-ink-3">
                    Recorded payments and reversals
                  </span>
                </span>
                <span className="text-[12.5px] text-[var(--accent-ink)]">
                  Open
                </span>
              </Link>
            </li>
          </ul>
        </details>
      </div>

      {overview.overdueInvoiceCount > 0 ? (
        <details className="rounded-card border border-line bg-paper p-4">
          <summary className="cursor-pointer font-medium">Overdue ageing</summary>
          <p className="mt-2 text-sm text-ink-3">Days past the due date (IST). Invoices due today are not yet late; these amounts are owed, not collected.</p>
          <ul className="mt-3 space-y-2.5">
            {overview.overdueAgeing.map((row) => (
              <li key={row.bucket}>
                <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="font-medium text-ink-2">{row.bucket} days</span>
                  <span className="tabular-nums text-ink-2">
                    {formatINR(row.paise)} · {row.count} invoice
                    {row.count === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-1">
                  <ProgressBar
                    value={row.paise}
                    max={overview.overduePaise}
                    tone="late"
                    label={`${row.bucket} days overdue`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
