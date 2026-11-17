import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { isLiveOwnerForSettings } from "@/lib/auth/owner-settings-page-guard";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { cookies } from "next/headers";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { eq } from "drizzle-orm";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { listPlansAction } from "@/lib/actions/membership-plans";
import { defaultMonthPeriod } from "@/lib/services/owner-reports";
import { FACILITY_COOKIE, resolveRequestedFacility } from "@/lib/facility";
import { canSelectFacility } from "@/lib/services/selected-facility-access";
import {
  getFeesOverviewAction,
  listHubInvoicesAction,
  listHubTransactionsAction,
} from "@/lib/actions/fees-hub";
import { formatINR } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import { methodLabel } from "@/lib/services/payments";
import {
  groupLabel,
  isPaymentGroup,
  isPaymentMethod,
} from "@/lib/money/payment-groups";
import { buttonClasses } from "@/components/ui/Button";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { SectionHeading } from "@/components/ui/PageHeader";
import { OwnerDesignHeading } from "@/components/owner-approved/owner-design-heading";
import { FEES_TABS, FeesTabs, type FeesTab } from "@/components/fees/fees-tabs";
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import { FeesTransactionList } from "@/components/fees/fees-transaction-list";
import { FeesPeriodControl } from "@/components/fees/fees-period-control";
import { FeesOverviewCards } from "@/components/fees/fees-overview-cards";
import type { ReactNode } from "react";
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
    invoice?: string;
  }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.financial");
  const params = searchParams ? await searchParams : {};
  const tab = resolveTab(params.tab);
  const cookieStore = await cookies();
  const scope = resolveRequestedFacility({
    facility: params.facility,
    cookie: cookieStore.get(FACILITY_COOKIE)?.value,
  });
  const facility = scope.facilityId;
  if (!scope.valid || (facility && !(await canSelectFacility(ctx, facility)))) {
    const recovery = new URLSearchParams({ tab, facility: "all" });
    if (params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from)) recovery.set("from", params.from);
    if (params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to)) recovery.set("to", params.to);
    return <OwnerPage><OwnerDesignHeading title="Club unavailable" purpose="This club is unavailable for your account." /><Link href={`/owner/fees?${recovery.toString()}`} className={buttonClasses({ variant: "secondary", size: "md" })}>View available clubs</Link></OwnerPage>;
  }
  // Plans management is settings.manage; reads stay open.
  const canManageSettings = hasPermission(ctx, "settings.manage") && await isLiveOwnerForSettings(ctx);
  const [tenant] = await withTenant(ctx.tenantId, (tx) => tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1));
  const timezone = tenant?.timezone ?? "Asia/Kolkata";
  const period =
    params.from && params.to
      ? { from: params.from, to: params.to }
      : defaultMonthPeriod(timezone);
  const terminology = await getTerminologyAction().then(ownerTerminology);
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
  const purpose =
    tab === "overview"
      ? "Review fees and payments."
      : tab === "transactions"
        ? "Recorded payments and their receipts."
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
      <OwnerDesignHeading title="Fees & payments" purpose={purpose} action={hasPermission(ctx, "payments.record") ? <Link href={`/owner/fees?tab=dues&from=${period.from}&to=${period.to}&facility=${facility ?? "all"}`} className={buttonClasses({ variant: "primary", size: "sm", className: "text-[13px]" })}>Review dues</Link> : null} />

      {tab === "overview" || tab === "transactions" ? (
        <FeesPeriodControl tab={tab} from={period.from} to={period.to} facility={facility ?? "all"} timezone={timezone} method={method} group={group} />
      ) : null}
      <div className="mt-4">
        <FeesTabs
          active={tab}
          period={period}
          facility={facility ?? "all"}
          canManageSettings={canManageSettings}
        />
      </div>

      {tab === "overview" ? (
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
              highlight
            />
            </div>
            <div role="group" aria-label="Current balances" className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3 lg:col-span-2">
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
              value={
                <span className={overview.overduePaise > 0 ? "text-late" : undefined}>
                  {formatINR(overview.overduePaise)}
                </span>
              }
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
                `&facility=${facility ?? "all"}`
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
          <FeesTransactionList rows={transactions.rows} memberLabel={memberLabel} canReadReceipts={hasPermission(ctx, "invoices.read")} />
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
            navigationNamespace={`${ctx.tenantId}:${ctx.userId}`}
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
            initialInvoiceId={params.invoice}
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
        </section>
      ) : null}
    </OwnerPage>
  );
}

function FeeMetric({ label, value, hint, href, highlight = false }: { label: string; value: ReactNode; hint: string; href?: string; highlight?: boolean }) {
  const content = <><p className="text-[12px] text-ink-3">{label}</p><p className="mt-2 break-words font-display text-[26px] font-semibold leading-tight tabular-nums">{value}</p><p className="mt-2 text-[12px] text-ink-3">{hint}</p></>;
  const className = `block h-full rounded-[18px] border border-line p-[18px] lg:p-5 ${highlight ? "bg-[var(--selected-surface)]" : "bg-paper"}`;
  return href ? <Link href={href} className={className}>{content}</Link> : <div className={className}>{content}</div>;
}
