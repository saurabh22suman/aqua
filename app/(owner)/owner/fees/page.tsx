import Link from "next/link";
import { cookies } from "next/headers";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { listPlansAction } from "@/lib/actions/membership-plans";
import { defaultMonthPeriod } from "@/lib/services/owner-reports";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";
import {
  getFeesOverviewAction,
  listHubInvoicesAction,
  listHubTransactionsAction,
} from "@/lib/actions/fees-hub";
import { formatINR } from "@/lib/money/format";
import { formatDateIST, formatPeriodRangeIST } from "@/lib/time/tz";
import { methodLabel } from "@/lib/services/payments";
import {
  groupLabel,
  isPaymentGroup,
  isPaymentMethod,
} from "@/lib/money/payment-groups";
import { buttonClasses } from "@/components/ui/Button";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";
import { FEES_TABS, FeesTabs, type FeesTab } from "@/components/fees/fees-tabs";
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import { FeesTransactionList } from "@/components/fees/fees-transaction-list";
import { StatCard } from "@/components/ui/StatCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";

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
  searchParams?: Promise<{
    tab?: string;
    from?: string;
    to?: string;
    facility?: string;
    method?: string;
    group?: string;
  }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.financial");
  // Plans management is settings.manage; reads stay open.
  const canManageSettings = hasPermission(ctx, "settings.manage");
  const params = searchParams ? await searchParams : {};
  const tab = resolveTab(params.tab);
  const cookieStore = await cookies();
  const facility = resolveFacilityValue(
    params.facility,
    cookieStore.get(FACILITY_COOKIE)?.value,
  );
  const timezone = await getTenantTimezoneAction();
  const period =
    params.from && params.to
      ? { from: params.from, to: params.to }
      : defaultMonthPeriod(timezone);
  const terminology = await getTerminologyAction();
  const memberLabel = titleCase(resolveTerm(terminology, "member", 1));
  // Home's payment-mix drill-down narrows this list (and only this list).
  const method = isPaymentMethod(params.method) ? params.method : undefined;
  const group = isPaymentGroup(params.group) ? params.group : undefined;
  const activeFilter = method
    ? methodLabel(method)
    : group
      ? `${groupLabel(group)} payments`
      : null;
  // OpenPen reference — only period-bound tabs name the reporting period.
  // Dues and Invoices describe current documents, so a month label there
  // would falsely narrow the balances to that period.
  const periodLabel = formatPeriodRangeIST(period.from, period.to);
  const purpose =
    tab === "overview"
      ? `Collect, reconcile and review — one place over plans, invoices, counter payments and receipts. Period ${periodLabel} (${timezone}).`
      : tab === "transactions"
        ? `Recorded payments and their receipts. Period ${periodLabel} (${timezone}).`
        : tab === "dues"
          ? "Current balances, with due dates and invoice state."
          : tab === "invoices"
            ? "Invoice documents, including paid and partial records."
            : "Read the plans catalogue; manage pricing in Settings.";

  const [overview, invoices, transactions, plans] = await Promise.all([
    getFeesOverviewAction({ ...period, ...(facility ? { locationId: facility } : {}) }),
    tab === "dues" || tab === "invoices"
      ? listHubInvoicesAction({
          status: tab === "dues" ? "dues" : "all",
          ...(facility ? { locationId: facility } : {}),
        })
      : Promise.resolve([]),
    tab === "transactions"
      ? listHubTransactionsAction({
          ...period,
          ...(facility ? { locationId: facility } : {}),
          ...(method ? { method } : {}),
          ...(group ? { group } : {}),
        })
      : // The ledger returns rows plus the count the filter matches, so a
        // truncated list can say so honestly instead of presenting a page as
        // the whole ledger.
        Promise.resolve({
          rows: [],
          totalCount: 0,
          truncated: false,
          limit: 200,
        }),
    tab === "plans" ? listPlansAction() : Promise.resolve([]),
  ]);
  return (
    <OwnerPage>
      <PageHeader title="Fees & payments" purpose={purpose} />

      <div className="mt-4">
        <FeesTabs
          active={tab}
          period={period}
          facility={facility}
          canManageSettings={canManageSettings}
        />
      </div>

      {tab === "overview" ? (
        <section className="mt-4 space-y-3">
          {/* Owner redesign (C2) — four figures in one row (2×2 on a
              phone), each stating its basis. The period collections
              are named as a period and the current balances say "now",
              so a historical collection is never read as a live
              balance. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
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
                facility ? `&facility=${facility}` : ""
              }`}
              tone="money"
            />
            <StatCard
              label="Outstanding now"
              value={formatINR(overview.outstandingPaise)}
              hint={`${overview.dueInvoiceCount} invoice${
                overview.dueInvoiceCount === 1 ? "" : "s"
              } with a balance`}
              href={`/owner/fees?tab=dues&from=${period.from}&to=${period.to}${
                facility ? `&facility=${facility}` : ""
              }`}
              tone="paper"
            />
            <StatCard
              label="Overdue now"
              value={
                <span className={overview.overduePaise > 0 ? "text-late" : undefined}>
                  {formatINR(overview.overduePaise)}
                </span>
              }
              hint={`${overview.overdueInvoiceCount} past the due date · today ${formatDateIST(
                overview.today,
              )}`}
              tone="paper"
            />
            <StatCard
              label="Payments in this period"
              value={overview.paymentCount}
              hint={
                overview.reversalCount > 0
                  ? `${overview.reversalCount} reversal${
                      overview.reversalCount === 1 ? "" : "s"
                    } recorded`
                  : "Recorded payments in the selected period"
              }
              href={`/owner/fees?tab=transactions&from=${period.from}&to=${period.to}${
                facility ? `&facility=${facility}` : ""
              }`}
              tone="deck"
            />
          </div>

          {/* OpenPen reference — one action into the invoice journey beside
              the financial evidence that explains the period. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {overview.dueInvoiceCount > 0 ? (
              <div className="rounded-card border border-line bg-paper p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <SectionHeading
                      title="Collect what is due"
                      subtitle={`${overview.dueInvoiceCount} invoice${
                        overview.dueInvoiceCount === 1 ? "" : "s"
                      } with a balance${
                        overview.overduePaise > 0
                          ? ` · ${formatINR(overview.overduePaise)} past the due date`
                          : ""
                      }. Open an invoice to record what the counter collected.`}
                    />
                  </div>
                  <Link
                    href={`/owner/fees?tab=dues&from=${period.from}&to=${period.to}${
                      facility ? `&facility=${facility}` : ""
                    }`}
                    className={buttonClasses({ variant: "primary", size: "md" })}
                  >
                    Review dues
                  </Link>
                </div>
              </div>
            ) : null}
            <div className="rounded-card border border-line bg-paper p-4">
              <SectionHeading
                title="Financial evidence"
                subtitle="Collections and recorded payments for the selected period."
              />
              <ul className="mt-2 divide-y divide-line text-[13px]">
                <li>
                  <Link
                    href="/owner/reports/collections"
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span>
                      Daily collections
                      <span className="mt-0.5 block text-[12px] text-ink-3">
                        Cash count and method breakdown
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
                      facility ? `&facility=${facility}` : ""
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
            </div>
          </div>
          {overview.overdueInvoiceCount > 0 ? (
            <div className="rounded-card border border-line bg-paper p-4">
              <SectionHeading
                title="Overdue ageing"
                subtitle="Days past the due date (IST). This is money owed, not money collected; invoices due today are not yet late."
              />
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
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "transactions" ? (
        <section className="mt-4 rounded-card border border-line bg-paper p-4">
          <SectionHeader
            title="Transactions"
            subtitle={activeFilter ? `Filtered to ${activeFilter}` : undefined}
          />
          {activeFilter ? (
            <Link
              href={`/owner/fees?tab=transactions&from=${period.from}&to=${period.to}${
                facility ? `&facility=${facility}` : ""
              }`}
              className="mt-1 inline-flex min-h-[44px] items-center text-[12.5px] text-water"
            >
              Clear filter
            </Link>
          ) : null}
          {transactions.truncated ? (
            <p className="mt-2 text-[12.5px] text-ink-3">
              Showing the newest {transactions.rows.length} of{" "}
              {transactions.totalCount} transactions in this period. Narrow the
              period or the filter to see the rest.
            </p>
          ) : null}
          <FeesTransactionList rows={transactions.rows} memberLabel={memberLabel} />
        </section>
      ) : null}

      {tab === "dues" ? (
        <section className="mt-4">
          <SectionHeading
            title="Outstanding invoices"
            subtitle="Oldest due first. Open an invoice to record what the counter collected — the balance updates and the receipt becomes available."
          />
          <FeesInvoiceList
            initial={invoices}
            filter="dues"
            facility={facility}
            canWrite={hasPermission(ctx, "invoices.write")}
            canVoid={hasPermission(ctx, "settings.manage")}
            canRecord={hasPermission(ctx, "payments.record")}
            canRefund={hasPermission(ctx, "payments.refund")}
            canReadPayments={hasPermission(ctx, "payments.read")}
            caption="Outstanding invoices"
          />
        </section>
      ) : null}

      {tab === "invoices" ? (
        <section className="mt-4">
          <SectionHeading
            title="Invoice ledger"
            subtitle="Every document, newest first — including settled and voided ones."
          />
          <FeesInvoiceList
            initial={invoices}
            filter="all"
            facility={facility}
            canWrite={hasPermission(ctx, "invoices.write")}
            canVoid={hasPermission(ctx, "settings.manage")}
            canRecord={hasPermission(ctx, "payments.record")}
            canRefund={hasPermission(ctx, "payments.refund")}
            canReadPayments={hasPermission(ctx, "payments.read")}
            caption="Invoice ledger"
          />
        </section>
      ) : null}

      {tab === "plans" ? (
        <section className="mt-4">
          <SectionHeading
            title="Available membership plans"
            trailing={
              canManageSettings ? (
                <Link href="/owner/settings/plans" className="text-[13px] text-water">
                  Manage plans →
                </Link>
              ) : null
            }
          />
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
    </OwnerPage>
  );
}
