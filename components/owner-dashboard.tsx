import Link from "next/link";
import {
  AlertTriangle,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  ListChecks,
  Receipt,
  UserPlus,
  Users,
} from "lucide-react";
import { AttentionRow } from "@/components/ui/AttentionRow";
import { CountChip } from "@/components/ui/CountChip";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatCard } from "@/components/ui/StatCard";
import { OwnerHomeCharts } from "@/components/owner-home-charts";
import type { ChartMetric, OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { OwnerDashboardData, TodaysLane } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";
import { TenantMark } from "@/components/branding/tenant-mark";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import { formatINRCompact } from "@/lib/money/format";
import {
  addDays,
  formatFullDateIST,
  formatWeekdayDateIST,
  formatWallTime12h,
} from "@/lib/time/tz";
import { logoutTenantAction } from "@/lib/actions/tenant-auth";

// Owner Home — the daily oversight workspace (composition contract in
// DESIGN.md §7). The owner is a reviewer, not an operator: the screen
// answers "what is happening, what is owed, what needs me" and never
// becomes a capture form or an attendance-marking console.
//
// Order, top to bottom on desktop:
//   1. identity header — academy, the location the figures cover, the
//      full date, the account menu (record search stays in the shell)
//   2. Summary — four figures whose labels state whether they are
//      today's, a current balance, or a count
//   3. one dominant shortcut (collect money) + quiet secondary actions
//   4. 60/40 — today's classes | at most three actionable exceptions
//   5. one trend panel with Attendance / Collections switching
//
// Every figure is a real read from lib/services/dashboard; zeroes say
// so in words ("No payments recorded today yet"), an unavailable
// percentage is "—", and completion (marks recorded) is never labelled
// attendance. Nothing here invents growth, targets, profit or weather.

const MAX_ATTENTION_ROWS = 3;

type Can = {
  addMember: boolean;
  recordPayment: boolean;
  captureEnquiry: boolean;
  readFees: boolean;
  viewSchedule: boolean;
};

export function OwnerDashboard({
  data,
  branding,
  terminology,
  chartsData,
  showOnboarding = false,
  can = {
    addMember: false,
    recordPayment: false,
    captureEnquiry: false,
    readFees: false,
    viewSchedule: false,
  },
  trend = "attendance",
  facility = null,
}: {
  data: OwnerDashboardData;
  branding: BrandingData;
  terminology: TerminologyState;
  chartsData?: OwnerChartsData | null;
  // Only a genuinely new academy gets the setup prompt; an established
  // academy with one unfinished checklist item does not.
  showOnboarding?: boolean;
  can?: Can;
  trend?: ChartMetric;
  // The resolved facility scope, carried into every drill-down link so
  // a narrowed Home never opens an unnarrowed destination.
  facility?: string | null;
}) {
  const displayName = branding.displayName ?? data.tenantName;
  const membersOther = resolveTerm(terminology, "member", "other");
  const memberOne = resolveTerm(terminology, "member", 1);
  const batchesOther = resolveTerm(terminology, "batch", "other");
  const sessionsOther = resolveTerm(terminology, "session", "other");
  const sessionsOne = resolveTerm(terminology, "session", 1);
  const coachOne = resolveTerm(terminology, "coach", 1);
  const enquiryOne = resolveTerm(terminology, "enquiry", 1);
  const facilitiesOther = resolveTerm(terminology, "facility", "other");
  const programsOther = resolveTerm(terminology, "program", "other");

  const scopeLabel =
    data.scopeLocationName ??
    (data.facilityBreakdown.length > 1 ? "All locations" : null);
  const attention = data.needsAttention;
  const visibleAttention = attention.slice(0, MAX_ATTENTION_ROWS);
  const hiddenAttention = attention.slice(MAX_ATTENTION_ROWS);
  const hasOverdue = data.money.overdueInvoiceCount > 0;
  const sessionCount = data.todaysLanes.length;

  const withFacility = (href: string) =>
    facility ? `${href}${href.includes("?") ? "&" : "?"}facility=${facility}` : href;
  const scopeParams = (params: Record<string, string>) => {
    const query = new URLSearchParams(params);
    if (facility) query.set("facility", facility);
    return `/owner/fees?${query.toString()}`;
  };

  const fees = {
    collected: scopeParams({
      tab: "transactions",
      from: data.today,
      to: addDays(data.today, 1),
    }),
    dues: scopeParams({ tab: "dues" }),
  };
  const membersHref = withFacility("/owner/members");
  const scheduleHref = facility
    ? `/owner/schedule?date=${data.today}&location=${facility}`
    : `/owner/schedule?date=${data.today}`;

  return (
    <main className="px-5 pt-5 pb-8">
      {/* 1 — identity, scope and date. The record search lives in the
          shell's top bar above this, so it is not duplicated here. */}
      <div className="flex items-start gap-3">
        <div className="flex-none">
          <TenantMark initials={branding.initials} accent={branding.accent} size={40} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[20px] font-semibold leading-tight">
            {displayName}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {scopeLabel ? `${scopeLabel} · ` : ""}
            {formatFullDateIST(data.today)}
          </p>
        </div>
        <details className="relative flex-none">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 rounded-ctl border border-line bg-paper px-3 text-[12.5px] font-medium text-ink-2 marker:content-none">
            Account
            <ChevronDown size={14} className="text-ink-3" aria-hidden="true" />
          </summary>
          <div className="absolute right-0 z-40 mt-1 w-44 rounded-ctl border border-line bg-paper p-1 shadow-2">
            <form action={logoutTenantAction}>
              <button
                type="submit"
                className="flex min-h-[44px] w-full items-center rounded-ctl px-3 text-[13px] font-medium text-ink-2"
              >
                Sign out
              </button>
            </form>
          </div>
        </details>
      </div>

      {/* Mobile reads task-first: the one shortcut, then the money, then
          the queue. Desktop leads with the figures. */}
      <div className="flex flex-col">
        {/* 2 — Summary. Each label states its basis: today, current
            balance, or a count. A figure that could not be read is "—",
            never ₹0. */}
        <div className="order-2 mt-4 grid grid-cols-2 gap-2 lg:order-1 lg:grid-cols-4">
          <StatCard
            label="Collected today"
            value={formatINRCompact(data.money.collectedTodayPaise)}
            hint={
              data.money.collectedTodayCount === 0
                ? "No payments recorded today yet"
                : `${data.money.collectedTodayCount} payment${
                    data.money.collectedTodayCount === 1 ? "" : "s"
                  } recorded`
            }
            href={can.readFees ? fees.collected : undefined}
            tone="paper"
          />
          <StatCard
            label="Overdue"
            value={
              <span className={hasOverdue ? "text-late" : undefined}>
                {formatINRCompact(data.money.overduePaise)}
              </span>
            }
            hint={
              hasOverdue
                ? `${data.money.overdueInvoiceCount} invoice${
                    data.money.overdueInvoiceCount === 1 ? "" : "s"
                  } past due · ${formatINRCompact(data.money.outstandingPaise)} outstanding`
                : `Nothing past due · ${formatINRCompact(
                    data.money.outstandingPaise,
                  )} outstanding`
            }
            href={can.readFees ? fees.dues : undefined}
            tone="paper"
          />
          <StatCard
            label={`Active ${membersOther}`}
            value={data.activeMemberCount}
            hint={`${data.activeBatchCount} ${batchesOther} running`}
            href={membersHref}
            tone="paper"
          />
          <StatCard
            label={`${titleCase(sessionsOther)} today`}
            value={sessionCount}
            hint={
              sessionCount === 0
                ? "Nothing scheduled today"
                : `${data.todayTotal} ${membersOther} enrolled`
            }
            href={can.viewSchedule ? scheduleHref : undefined}
            tone="paper"
          />
        </div>

        {/* 3 — one dominant shortcut. Money is the owner's authority, so
            collecting a payment is the primary action and goes to the
            real journey (Dues → open an invoice → record payment), never
            to a history list. Secondary actions are quiet links. */}
        <div
          className="order-1 mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 lg:order-2"
          style={{ columnGap: 20, rowGap: 4 }}
        >
          {can.recordPayment ? (
            <Link
              href={fees.dues}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-ctl bg-[var(--accent-strong)] px-4 text-[13.5px] font-semibold text-white"
            >
              <Receipt size={16} aria-hidden="true" />
              Collect payment
            </Link>
          ) : null}
          {can.addMember || can.captureEnquiry ? (
            <span
              aria-hidden="true"
              className="hidden h-6 w-px flex-none bg-line lg:block"
            />
          ) : null}
          {can.addMember ? (
            <Link
              href="/owner/members/new"
              style={{ gap: 8 }}
              className="inline-flex min-h-[44px] items-center text-[13.5px] font-medium text-ink-2"
            >
              <UserPlus size={16} className="text-ink-3" aria-hidden="true" />
              Add {memberOne}
            </Link>
          ) : null}
          {can.captureEnquiry ? (
            <Link
              href="/owner/enquiries"
              style={{ gap: 8 }}
              className="inline-flex min-h-[44px] items-center text-[13.5px] text-ink-2"
            >
              <ClipboardList size={16} className="text-ink-3" aria-hidden="true" />
              Capture {enquiryOne}
            </Link>
          ) : null}
        </div>
      </div>

      {/* 4 — desktop 60/40: the day's classes beside the exceptions.
          On mobile the queue comes first so the actionable items are
          reachable early; the day's classes follow. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-5 lg:items-start">
        <section className="order-2 min-w-0 lg:order-1 lg:col-span-3" aria-labelledby="today-heading">
          <SectionHeader
            className="mb-2"
            title="Today"
            subtitle={
              sessionCount === 0
                ? "Nothing scheduled today"
                : data.todayTotal > 0
                  ? `${data.todayMarked} of ${data.todayTotal} marked across ${sessionCount} ${sessionCount === 1 ? sessionsOne : sessionsOther}`
                  : `${sessionCount} ${sessionCount === 1 ? sessionsOne : sessionsOther} scheduled · no ${membersOther} enrolled yet`
            }
            trailing={
              sessionCount > 0 ? (
                <CountChip count={sessionCount} label={titleCase(sessionsOther)} />
              ) : undefined
            }
          />
          {sessionCount === 0 ? (
            <div className="rounded-card border border-line bg-paper px-4 py-4">
              {data.nextClass ? (
                <>
                  <p className="text-[13.5px] font-medium">
                    Next: {data.nextClass.batchName}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
                    {formatWeekdayDateIST(data.nextClass.sessionDate)} at{" "}
                    {formatWallTime12h(data.nextClass.startTime)}
                    {data.nextClass.coachName
                      ? ` · ${data.nextClass.coachName}`
                      : ` · no ${coachOne} assigned`}{" "}
                    · {data.nextClass.enrolled} of {data.nextClass.capacity} enrolled
                  </p>
                </>
              ) : (
                <p className="text-[13.5px] font-medium">
                  Nothing scheduled today, and no class booked ahead.
                </p>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line bg-paper">
              {data.todaysLanes.map((lane) => {
                const register = registerState(lane);
                const overBy = lane.capacity > 0 ? lane.enrolled - lane.capacity : 0;
                const overCapacity = overBy > 0;
                const fillPct =
                  lane.capacity > 0
                    ? Math.min(100, Math.round((lane.enrolled / lane.capacity) * 100))
                    : 0;
                return (
                  <li key={lane.sessionId} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-[14px] font-medium">
                        {`${formatWallTime12h(lane.startTime)} · ${lane.batchName}`}
                      </p>
                      <span
                        className={`flex-none text-[12px] tabular-nums ${
                          overCapacity ? "font-semibold text-late" : "text-ink-3"
                        }`}
                      >
                        {lane.enrolled} / {lane.capacity}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-3">
                      {lane.programName}
                      {lane.coachName ? ` · ${lane.coachName}` : ` · no ${coachOne} assigned`}
                    </p>
                    <div className="mt-2">
                      <ProgressBar
                        value={lane.enrolled}
                        max={lane.capacity}
                        tone={overCapacity ? "late" : fillPct < 50 ? "warn" : "water"}
                        label={`${lane.batchName} capacity`}
                      />
                    </div>
                    {overCapacity ? (
                      <p className="mt-1.5 text-[11.5px] font-semibold text-late">
                        Over capacity by {overBy} — {lane.enrolled} enrolled against{" "}
                        {lane.capacity} places
                      </p>
                    ) : null}
                    <p className={`mt-1.5 text-[11.5px] font-medium ${register.className}`}>
                      {register.text}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="order-1 min-w-0 lg:order-2 lg:col-span-2" aria-labelledby="attention-heading">
          <SectionHeader
            className="mb-2"
            title="Needs you today"
            trailing={
              attention.length > 0 ? (
                <CountChip count={attention.length} tone="warn" />
              ) : undefined
            }
          />
          {attention.length === 0 ? (
            <div className="rounded-card border border-line bg-paper px-4 py-4">
              <p className="text-[13.5px] font-medium">
                Nothing needs attention right now.
              </p>
              {showOnboarding ? (
                <p className="mt-1 text-[12.5px] text-ink-3">
                  Setting the academy up is the next thing worth doing.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <ul>
                {visibleAttention.map((item, i) => (
                  <li key={i} className="mb-2">
                    <AttentionRow
                      icon={<AlertTriangle size={16} strokeWidth={2} />}
                      title={item.title}
                      detail={item.detail}
                      href={item.href ?? undefined}
                      tone={item.title === "Overdue fees" ? "late" : "warn"}
                    />
                  </li>
                ))}
              </ul>
              {hiddenAttention.length > 0 ? (
                <details className="mt-1">
                  <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink-2 marker:content-none">
                    {hiddenAttention.length} more need attention
                    <ChevronDown size={14} className="text-ink-3" aria-hidden="true" />
                  </summary>
                  <ul className="mt-1">
                    {hiddenAttention.map((item, i) => (
                      <li key={i} className="mb-2">
                        <AttentionRow
                          icon={<AlertTriangle size={16} strokeWidth={2} />}
                          title={item.title}
                          detail={item.detail}
                          href={item.href ?? undefined}
                          tone={item.title === "Overdue fees" ? "late" : "warn"}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </section>
      </div>

      {/* 5 — the chart band: one wide metric panel beside the payment
          mix. Both are scoped to the selected period and facility. */}
      <OwnerHomeCharts
        data={chartsData ?? null}
        metric={trend}
        facility={facility}
        canReadFees={can.readFees}
      />

      {/* W1-6 — consolidated per-facility view, only for multi-site
          tenants; a single site needs no comparison. */}
      {data.facilityBreakdown.length > 1 ? (
        <section className="mt-4">
          <h2 className="mb-2 font-display text-[15px] font-semibold">
            By {facilitiesOther}
          </h2>
          <ul className="divide-y divide-line rounded-card border border-line bg-paper">
            {data.facilityBreakdown.map((row) => (
              <li
                key={row.locationId}
                className="flex items-center justify-between gap-3 px-3.5 py-3"
              >
                <span className="min-w-0 truncate text-[13.5px] font-medium">
                  {row.locationName}
                </span>
                <span className="flex-none text-[12px] text-ink-3">
                  {row.activeMembers} active ·{" "}
                  {row.attendancePct === null
                    ? "no attendance yet"
                    : `${row.attendancePct}% this week`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Phone access to the destinations the four-item bottom nav does
          not carry. Desktop reaches them from the sidebar. */}
      <div className="mt-4 grid grid-cols-2 gap-2 lg:hidden">
        {[
          { href: "/owner/fees", label: "Fees & payments", icon: Receipt },
          { href: "/owner/enquiries", label: titleCase(resolveTerm(terminology, "enquiry", "other")), icon: ClipboardList },
          { href: "/owner/programs", label: `${titleCase(programsOther)} & ${batchesOther}`, icon: CalendarRange },
          { href: "/owner/staff", label: "Staff", icon: Users },
          ...(showOnboarding
            ? [{ href: "/owner/onboarding", label: "Onboarding", icon: ListChecks }]
            : []),
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex min-h-[48px] items-center gap-2.5 rounded-ctl border border-line bg-paper px-3.5 py-2"
          >
            <link.icon size={16} className="flex-none text-ink-3" aria-hidden="true" />
            <span className="text-[13px] font-medium">{link.label}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

// Register state = COMPLETION (marks recorded out of the distinct
// swimmers expected), never attendance. A mark of any status counts —
// the register has been filled for that swimmer.
function registerState(lane: TodaysLane): { text: string; className: string } {
  const marked = Math.min(lane.marked, lane.enrolled);
  if (lane.enrolled === 0) {
    return { text: "No one enrolled yet", className: "text-ink-3" };
  }
  if (!lane.started) {
    return { text: "Register opens when the session starts", className: "text-ink-3" };
  }
  if (marked === 0) {
    return { text: "Register not started", className: "text-warn" };
  }
  if (marked < lane.enrolled) {
    return {
      text: `Register in progress — ${marked} of ${lane.enrolled} marked`,
      className: "text-ink-2",
    };
  }
  return {
    text: `Register complete — ${marked} of ${lane.enrolled} marked`,
    className: "text-good",
  };
}
