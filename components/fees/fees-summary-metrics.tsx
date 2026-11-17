import type { ReactNode } from "react";
import type { FeesOverview } from "@/lib/services/fees-hub";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { formatINR } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import { buttonClasses } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { FeesOverviewCards } from "@/components/fees/fees-overview-cards";

export function FeesSummaryMetrics({ overview, facility, period }: { overview: FeesOverview; facility?: string | null; period: { from: string; to: string } }) {
  return (
        <section className="mt-4 space-y-3">
          <div className="grid gap-3 lg:grid-cols-3">
            <div role="group" aria-label="Period collections" className="min-w-0">
            <FeeMetric
              label="Collected in this period"
              value={formatINR(overview.collectedPaise)}
              hint={`${overview.paymentCount} payment${
                overview.paymentCount === 1 ? "" : "s"
              } captured at the counter${
                overview.reversedPaise > 0
                  ? ` · ${formatINR(overview.reversedPaise)} reversed separately (${overview.reversalCount})`
                  : ""
              }`}
              href={`/owner/fees?tab=transactions&from=${period.from}&to=${period.to}${
                `&facility=${facility ?? "all"}`
              }`}
              highlight={overview.collectedPaise > 0}
            />
            </div>
            <div role="group" aria-label="Current balances" className="grid min-w-0 gap-3 sm:grid-cols-2 lg:col-span-2">
            <FeeMetric
              label="Outstanding now"
              value={formatINR(overview.outstandingPaise)}
              hint={`${overview.dueInvoiceCount} invoice${
                overview.dueInvoiceCount === 1 ? "" : "s"
              } with a balance`}
              href={`/owner/fees?tab=dues&from=${period.from}&to=${period.to}${
                `&facility=${facility ?? "all"}`
              }`}
            />
            <FeeMetric
              label="Overdue now"
              value={formatINR(overview.overduePaise)}
              attention={overview.overduePaise > 0}
              hint={`${overview.overdueInvoiceCount} past the due date · today ${formatDateIST(
                overview.today,
              )}`}
            />
            </div>
          </div>
          <p className="text-[12px] text-ink-3">Outstanding and overdue are current balances.</p>
          <FeesOverviewCards overview={overview} facility={facility ?? "all"} from={period.from} to={period.to} />

          {/* OpenPen reference — one action into the invoice journey beside
              the financial evidence that explains the period. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {overview.dueInvoiceCount > 0 ? (
              <div className="rounded-card border border-line bg-paper p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <SectionHeading
                      title="Collect what is due"
                      subtitle="Open an invoice to record a payment."
                    />
                  </div>
                  <Link
                    href={`/owner/fees?tab=dues&from=${period.from}&to=${period.to}${
                      `&facility=${facility ?? "all"}`
                    }`}
                    className={buttonClasses({ variant: "primary", size: "md" })}
                  >
                    Review dues
                  </Link>
                </div>
              </div>
            ) : null}
            <details className="rounded-card border border-line bg-paper p-4">
              <summary className="cursor-pointer font-medium">Financial evidence</summary>
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
                    href={`/owner/fees?tab=transactions&from=${period.from}&to=${period.to}${
                      `&facility=${facility ?? "all"}`
                    }`}
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

function FeeMetric({ label, value, hint, href, highlight = false, attention = false }: { label: string; value: ReactNode; hint: string; href?: string; highlight?: boolean; attention?: boolean }) {
  const content = <><p className="text-[12px] text-ink-2">{label}</p><p className="mt-2 whitespace-nowrap font-display text-[20px] font-semibold leading-tight tabular-nums">{value}</p><p className="mt-2 text-[12px] text-ink-2">{hint}</p></>;
  const className = `block h-full rounded-[18px] border p-[18px] lg:p-5 ${attention ? "border-[var(--surface-attention-border)] bg-[var(--surface-attention)]" : highlight ? "border-line bg-[var(--surface-featured)]" : "border-line bg-paper"}`;
  return href ? <Link href={href} className={className}>{content}</Link> : <div className={className}>{content}</div>;
}
