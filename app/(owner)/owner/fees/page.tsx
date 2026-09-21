import Link from "next/link";
import { requireOwner } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { listPlansAction } from "@/lib/actions/membership-plans";
import { defaultMonthPeriod } from "@/lib/services/owner-reports";
import {
  getFeesOverviewAction,
  listHubInvoicesAction,
  listHubTransactionsAction,
} from "@/lib/actions/fees-hub";
import { formatINR } from "@/lib/money/format";
import { formatDateIST, formatDateTimeIST } from "@/lib/time/tz";
import { methodLabel } from "@/lib/services/payments";
import { BackLink } from "@/components/ui/BackLink";
import { FEES_TABS, FeesTabs, type FeesTab } from "@/components/fees/fees-tabs";
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";

// U-02 — the Fees & Payments hub: Overview / Transactions / Dues /
// Invoices / Plans over the existing C-29…C-39 services. Tabs are
// URL state, every read is its own server-rendered action. The Plans
// tab shows plans only — discounts are Phase 5 and appear nowhere,
// not even as a stub.

const TAB_KEYS = new Set(FEES_TABS.map((t) => t.key));

function resolveTab(value: string | undefined): FeesTab {
  return TAB_KEYS.has(value as FeesTab) ? (value as FeesTab) : "overview";
}

export default async function FeesPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const ctx = await requireOwner();
  const params = searchParams ? await searchParams : {};
  const tab = resolveTab(params.tab);
  const timezone = await getTenantTimezoneAction();
  const period =
    params.from && params.to
      ? { from: params.from, to: params.to }
      : defaultMonthPeriod(timezone);
  const terminology = await getTerminologyAction();
  const memberLabel = titleCase(resolveTerm(terminology, "member", 1));

  const [overview, invoices, transactions, plans] = await Promise.all([
    getFeesOverviewAction(period),
    tab === "dues" || tab === "invoices"
      ? listHubInvoicesAction({ status: tab === "dues" ? "dues" : "all" })
      : Promise.resolve([]),
    tab === "transactions"
      ? listHubTransactionsAction(period)
      : Promise.resolve([]),
    tab === "plans" ? listPlansAction() : Promise.resolve([]),
  ]);

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/reports" label="Reports" />
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Fees &amp; payments
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Collect, reconcile and review — one place over plans, invoices,
        counter payments and receipts. Period {formatDateIST(period.from)} to{" "}
        {formatDateIST(period.to)} ({timezone}).
      </p>

      <div className="mt-4">
        <FeesTabs active={tab} period={period} />
      </div>

      {tab === "overview" ? (
        <section className="mt-4 space-y-3">
          <div className="rounded-card border border-line bg-paper p-4">
            <p className="text-[12px] text-ink-3">Collected this period</p>
            <p className="mt-1 font-display text-[26px] font-semibold tabular-nums">
              {formatINR(overview.collectedPaise)}
            </p>
            <p className="text-[12px] text-ink-3">
              {overview.paymentCount} payment
              {overview.paymentCount === 1 ? "" : "s"} recorded at the counter
              {overview.reversedPaise > 0
                ? `, net of ${formatINR(overview.reversedPaise)} reversed (${overview.reversalCount})`
                : ""}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-paper p-4">
              <p className="text-[12px] text-ink-3">Outstanding</p>
              <p className="mt-1 font-display text-[19px] font-semibold tabular-nums">
                {formatINR(overview.outstandingPaise)}
              </p>
              <p className="text-[12px] text-ink-3">
                {overview.dueInvoiceCount} invoice
                {overview.dueInvoiceCount === 1 ? "" : "s"} with a balance
              </p>
              <Link
                href={`/owner/fees?tab=dues&from=${period.from}&to=${period.to}`}
                className="mt-2 inline-block text-[13px] text-water"
              >
                Work the dues →
              </Link>
            </div>
            <div className="rounded-card border border-line bg-paper p-4">
              <p className="text-[12px] text-ink-3">Overdue</p>
              <p
                className={`mt-1 font-display text-[19px] font-semibold tabular-nums ${
                  overview.overduePaise > 0 ? "text-late" : "text-ink"
                }`}
              >
                {formatINR(overview.overduePaise)}
              </p>
              <p className="text-[12px] text-ink-3">
                {overview.overdueInvoiceCount} past the due date · today{" "}
                {formatDateIST(overview.today)}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "transactions" ? (
        <section className="mt-4 rounded-card border border-line bg-paper p-4">
          <h2 className="font-display text-[15px] font-semibold">
            Transactions
          </h2>
          {transactions.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">
              No counter payments in this period.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-ink-3">
                    <th className="py-1 font-medium">Received</th>
                    <th className="py-1 font-medium">{memberLabel}</th>
                    <th className="py-1 font-medium">Invoice</th>
                    <th className="py-1 font-medium">Method</th>
                    <th className="py-1 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id} className="border-t border-line">
                      <td className="py-1.5 text-ink-3">
                        {formatDateTimeIST(t.receivedAt)}
                      </td>
                      <td className="py-1.5 text-ink">
                        {t.memberName ?? "—"}
                      </td>
                      <td className="py-1.5 font-mono text-ink-3">
                        {t.invoiceNumber ?? "—"}
                      </td>
                      <td className="py-1.5 text-ink-2">
                        {t.kind === "reversal" ? (
                          <span>
                            Reversal
                            {t.reason ? (
                              <span className="ml-1 text-ink-3">{t.reason}</span>
                            ) : null}
                          </span>
                        ) : (
                          <>
                            {methodLabel(t.method)}
                            {t.reference ? (
                              <span className="ml-1 text-ink-3">{t.reference}</span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td
                        className={`py-1.5 text-right font-mono ${
                          t.amountPaise < 0 ? "text-late" : "text-ink"
                        }`}
                      >
                        {t.amountPaise < 0
                          ? `−${formatINR(Math.abs(t.amountPaise))}`
                          : formatINR(t.amountPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {tab === "dues" ? (
        <section className="mt-4">
          <h2 className="font-display text-[15px] font-semibold">Dues</h2>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Oldest due first. Open an invoice to record what the counter
            collected — the balance updates and the receipt becomes available.
          </p>
          <FeesInvoiceList
            initial={invoices}
            filter="dues"
            canWrite={hasPermission(ctx, "invoices.write")}
            canRecord={hasPermission(ctx, "payments.record")}
            canRefund={hasPermission(ctx, "payments.refund")}
          />
        </section>
      ) : null}

      {tab === "invoices" ? (
        <section className="mt-4">
          <h2 className="font-display text-[15px] font-semibold">Invoices</h2>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Every document, newest first — including settled and voided ones.
          </p>
          <FeesInvoiceList
            initial={invoices}
            filter="all"
            canWrite={hasPermission(ctx, "invoices.write")}
            canRecord={hasPermission(ctx, "payments.record")}
            canRefund={hasPermission(ctx, "payments.refund")}
          />
        </section>
      ) : null}

      {tab === "plans" ? (
        <section className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-[15px] font-semibold">Plans</h2>
            <Link
              href="/owner/settings/plans"
              className="text-[13px] text-water"
            >
              Manage plans →
            </Link>
          </div>
          {plans.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">
              No priced plans yet. Price a preset template or add your own
              from Manage plans.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
              {plans.map((plan) => (
                <li key={plan.id} className="px-3.5 py-2.5 text-[13px]">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">{plan.name}</span>
                    <span className="font-mono text-ink">
                      {formatINR(plan.amountPaise)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {plan.kind === "duration"
                      ? `${plan.durationDays}-day plan`
                      : plan.kind === "sessions"
                        ? `${plan.sessions}-session pack`
                        : "One-time"}{" "}
                    · {plan.locationName}
                    {plan.activityName ? ` · ${plan.activityName}` : " · all-access"}
                    {plan.isActive ? "" : " · archived"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] text-ink-3">
            Discount codes are a Phase 5 feature and are not part of this
            release.
          </p>
        </section>
      ) : null}
    </main>
  );
}
