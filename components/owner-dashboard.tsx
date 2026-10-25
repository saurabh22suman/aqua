import Link from "next/link";
import {
  AlertTriangle,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  Clock,
  ListChecks,
  Receipt,
  UserPlus,
  Users,
} from "lucide-react";
import { AttentionRow } from "@/components/ui/AttentionRow";
import { CountChip } from "@/components/ui/CountChip";
import { LaneStrip } from "@/components/ui/LaneStrip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatCard } from "@/components/ui/StatCard";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";
import type { CollectionsSeries, TrendPoint } from "@/lib/services/owner-analytics";
import { DashboardTrends } from "@/components/dashboard-trends";
import { TenantMark } from "@/components/branding/tenant-mark";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import { formatINR } from "@/lib/money/format";
import { formatWallTime12h } from "@/lib/time/tz";
import { logoutTenantAction } from "@/lib/actions/tenant-auth";

// Owner "Today" — the calm first screen.
//
// Owner UX audit (2026-10-24). The old home led with a large marine
// money hero, then the attention list, then a register card, then
// three KPI tiles, then two charts, then (on mobile) a link grid
// pushed under every summary section. On a seeded club that read as a
// wall of zeroes with four different empty messages in it, and the
// everyday actions (add a swimmer, record a payment, capture an
// enquiry) were nowhere on the screen.
//
// The order below is the audit's proposal, and each block answers ONE
// question:
//
//   1. header   — where am I, what day is it, and how do I get out
//   2. actions  — what do I came here to do
//   3. attention — what is wrong (at most three, with the real total)
//   4. classes  — what is happening today
//   5. money    — what came in and what is owed (compact, linked)
//   6. tiles    — the three standing figures
//   7. trends   — the one trend link, and the drill-throughs
//
// Honesty rules kept from S4/C02: zeroes state themselves ("No
// payments recorded today yet", "No dues outstanding", "Nothing past
// due"), a null attendance percentage is "—", and no profit/cost
// figure exists anywhere because no such data exists in the schema.
// The money block is a compact row, not a hero: it was the largest
// area on the page and the numbers were zeroes.

const MAX_ATTENTION_ROWS = 3;

export function OwnerDashboard({
  data,
  branding,
  terminology,
  charts,
  showOnboarding = true,
  can = { addMember: false, recordPayment: false, captureEnquiry: false },
}: {
  data: OwnerDashboardData;
  branding: BrandingData;
  terminology: TerminologyState;
  charts?: {
    attendance: TrendPoint[] | null;
    collections: CollectionsSeries | null;
  };
  showOnboarding?: boolean;
  // Which everyday actions this caller may actually perform. The
  // audit asked for them near the top; the permission gates decide
  // which ones exist (the owner's full set, an accountant's finance
  // set, a viewer sees none of them).
  can?: { addMember: boolean; recordPayment: boolean; captureEnquiry: boolean };
}) {
  const dayLabel = new Date(`${data.today}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const todayPct = data.todayTotal > 0 ? Math.round((data.todayMarked / data.todayTotal) * 100) : null;
  // The display name surfaces the tenant's preferred name when
  // it has one (Phase 2.9 editable); falls back to the column
  // name when it doesn't. data.tenantName is the column-level
  // fallback, branding.displayName is the override.
  const displayName = branding.displayName ?? data.tenantName;
  // Phase 2.10 — the resolved vocabulary: a swimming academy
  // sees "Active swimmers" rather than "Active members"; a
  // tenant that never customised still reads "Active members".
  // Database columns stay canonical (member_code is never
  // renamed), per architecture § 7.5.
  const membersOther = resolveTerm(terminology, "member", "other");
  const batchesOther = resolveTerm(terminology, "batch", "other");
  const sessionsOther = resolveTerm(terminology, "session", "other");
  const sessionsOne = resolveTerm(terminology, "session", 1);
  const facilitiesOther = resolveTerm(terminology, "facility", "other");
  const overdueCount = data.money.overdueInvoiceCount;
  const hasOverdue = overdueCount > 0;
  const attention = data.needsAttention;
  const visibleAttention = attention.slice(0, MAX_ATTENTION_ROWS);
  const hiddenAttention = attention.slice(MAX_ATTENTION_ROWS);

  return (
    <main className="px-5 pt-5 pb-8">
      {/* 1 — compact header: who and when, plus the way out. The
          sign-out lives in an account menu rather than a full-width
          button in the header; P1-4 put it in the header because it
          used to be three taps deep in Settings, and the audit's
          answer is one tap from here either way. */}
      <div className="flex items-center gap-3">
        <div className="flex-none">
          <TenantMark initials={branding.initials} accent={branding.accent} size={40} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[19px] font-semibold leading-tight">{displayName}</h1>
          <p className="text-[12.5px] text-ink-3">{dayLabel}</p>
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

      {/* 2 — the everyday actions, first. Each one opens the existing
          workflow: the register form, the counter's transactions tab,
          the enquiry capture on the enquiries board. Nothing here is a
          second implementation of a workflow that already exists. */}
      {can.addMember || can.recordPayment || can.captureEnquiry ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {can.addMember ? (
            <Link
              href="/owner/members/new"
              className="flex min-h-[44px] items-center gap-2 rounded-ctl bg-[var(--accent-strong)] px-3.5 text-[13.5px] font-semibold text-white"
            >
              <UserPlus size={16} aria-hidden="true" />
              Add {resolveTerm(terminology, "member", 1)}
            </Link>
          ) : null}
          {can.recordPayment ? (
            <Link
              href="/owner/fees?tab=transactions"
              className="flex min-h-[44px] items-center gap-2 rounded-ctl border border-line bg-paper px-3.5 text-[13.5px] font-medium"
            >
              <Receipt size={16} className="text-ink-3" aria-hidden="true" />
              Record payment
            </Link>
          ) : null}
          {can.captureEnquiry ? (
            <Link
              href="/owner/enquiries"
              className="flex min-h-[44px] items-center gap-2 rounded-ctl border border-line bg-paper px-3.5 text-[13.5px] font-medium"
            >
              <ClipboardList size={16} className="text-ink-3" aria-hidden="true" />
              Capture enquiry
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* The operational links the four-item bottom nav does not carry
          (Fees, Enquiries, Programs, Staff). The audit found them
          BELOW several summary sections on a phone, so they sit
          directly under the actions where a phone can reach them. On
          the desktop the sidebar already carries them. */}
      <div className="mt-3 grid grid-cols-2 gap-2 lg:hidden">
        {[
          { href: "/owner/fees", label: "Fees & payments", icon: Receipt },
          { href: "/owner/enquiries", label: "Enquiries", icon: ClipboardList },
          { href: "/owner/programs", label: "Programs & sessions", icon: CalendarRange },
          { href: "/owner/staff", label: "Staff", icon: Users },
          ...(showOnboarding
            ? [{ href: "/owner/onboarding", label: "Onboarding", icon: ListChecks }]
            : []),
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-2.5 rounded-ctl bg-paper border border-line px-3.5 min-h-[48px] py-2"
          >
            <link.icon size={16} className="text-ink-3 flex-none" aria-hidden="true" />
            <span className="text-[13px] font-medium">{link.label}</span>
          </Link>
        ))}
      </div>

      {/* 3 — what needs attention. At most three rows carry the
          screen; the count chip says the real total, and anything
          beyond the third stays one disclosure away so nothing is
          hidden from the owner. */}
      <SectionHeader
        className="mt-7 mb-2.5"
        title="Needs you today"
        trailing={
          attention.length > 0 ? (
            <CountChip count={attention.length} tone="warn" />
          ) : undefined
        }
      />
      {attention.length === 0 ? (
        <div className="rounded-ctl border border-line bg-paper px-4 py-5">
          <p className="text-[13.5px] font-medium">Nothing needs attention right now.</p>
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
                    />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}

      {/* 4 — today's classes. A quiet day gets one calm line and the
          next scheduled class, so the space says something instead of
          repeating that nothing is scheduled. */}
      <SectionHeader className="mt-7 mb-2.5" title="Today’s classes" />
      {data.todaysLanes.length === 0 ? (
        <div className="rounded-ctl border border-line bg-paper px-4 py-5">
          <p className="text-[13.5px] font-medium">Nothing scheduled today</p>
          {data.nextClass ? (
            <p className="mt-1 text-[12.5px] text-ink-3">
              Next: {data.nextClass.batchName} at{" "}
              {formatWallTime12h(data.nextClass.startTime)} on{" "}
              {new Date(`${data.nextClass.sessionDate}T00:00:00`).toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
              .
            </p>
          ) : (
            <p className="mt-1 text-[12.5px] text-ink-3">
              Nothing is scheduled for today, and there is no class booked ahead.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {data.todaysLanes.map((lane) => {
            const fillPct =
              lane.capacity > 0
                ? Math.min(100, Math.round((lane.enrolled / lane.capacity) * 100))
                : 0;
            // water normally, warn under half full — DESIGN.md's lane
            // strip rule ("water normally, warn when under-filled, late
            // when a problem"); no "problem" state is detectable from
            // today's schema (an overbooked batch can't happen, C-18
            // enforces capacity at enrolment), so only the first two apply.
            return (
              <LaneStrip
                key={lane.batchId}
                time={formatWallTime12h(lane.startTime)}
                title={lane.batchName}
                subtitle={lane.programName}
                started={lane.capacity}
                ended={lane.enrolled}
                tone={fillPct < 50 ? "warn" : "water"}
                icon={<Clock size={13} className="text-ink-3" />}
                testId="owner-lane"
              />
            );
          })}
        </div>
      )}

      {/* Register completion — the execution detail, below the classes
          it belongs to. Null (not 0%) when nothing is scheduled today
          at all; that's a different, truthful state, not a fabricated
          zero.

          F-2 (2026-09-13 Indian-user UX audit): the "nothing
          scheduled" branch used to key off todayTotal (sum of
          enrolments), so a day with a real session but no one enrolled
          read "Nothing scheduled today" directly above a lane listing
          that same session. "Is anything scheduled" is todayLanes,
          full stop; enrolment is a separate fact stated in its own
          branch. */}
      {data.todaysLanes.length > 0 ? (
        <div className="mt-3 rounded-card border border-line bg-paper px-5 py-4">
          <p className="text-[12.5px] font-medium text-ink-3">Today&apos;s registers</p>
          {data.todayTotal > 0 ? (
            <>
              <p className="mt-1.5 mb-1 font-display text-[26px] font-semibold tracking-tight leading-none tabular-nums">
                {todayPct}%
              </p>
              <p className="text-[13px] text-ink-3">
                {data.todayMarked} of {data.todayTotal} marked across {data.todaysLanes.length}{" "}
                {data.todaysLanes.length === 1 ? sessionsOne : sessionsOther}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-[15px] font-medium">
              {data.todaysLanes.length}{" "}
              {data.todaysLanes.length === 1 ? sessionsOne : sessionsOther} scheduled &middot; no{" "}
              {membersOther} enrolled yet
            </p>
          )}
        </div>
      ) : null}

      {/* 5 — money, compact. The audit's finding was that the largest
          area on the page held zeroes; the figures are unchanged (the
          dashboard service's real daily-collections and fees-overview
          reads) and each one links to the itemised view. The gross
          captured total is titled "Payments recorded today"; the Fees
          hub's per-period figure is net of reversals — the two
          screens must not read as the same number.

          Overdue switches to the late (red) money tone only when
          there is something overdue — colour means money state, never
          decoration. */}
      <SectionHeader className="mt-7 mb-2.5" title="Money" subtitle="Today and what is owed" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Link
          href="/owner/fees?tab=transactions"
          className="rounded-ctl border border-line bg-paper px-3.5 py-3"
        >
          {/* C02: this figure is the GROSS captured total, so it is
              titled "Payments recorded today"; the Fees hub's
              per-period figure is net of reversals, and the two
              screens must not read as the same number. */}
          <p className="text-[12px] text-ink-3">Payments recorded today</p>
          <p className="mt-1 font-display text-[20px] font-semibold leading-none tabular-nums">
            {formatINR(data.money.collectedTodayPaise)}
          </p>
          <p className="mt-1 text-[11.5px] text-ink-3">
            {data.money.collectedTodayCount === 0
              ? "No payments recorded today yet"
              : `${data.money.collectedTodayCount} payment${
                  data.money.collectedTodayCount === 1 ? "" : "s"
                } recorded`}
          </p>
        </Link>
        <Link
          href="/owner/fees?tab=dues"
          className="rounded-ctl border border-line bg-paper px-3.5 py-3"
        >
          <p className="text-[12px] text-ink-3">Outstanding</p>
          <p className="mt-1 font-display text-[20px] font-semibold leading-none tabular-nums">
            {formatINR(data.money.outstandingPaise)}
          </p>
          <p className="mt-1 text-[11.5px] text-ink-3">
            {data.money.dueInvoiceCount === 0
              ? "No dues outstanding"
              : `${data.money.dueInvoiceCount} invoice${
                  data.money.dueInvoiceCount === 1 ? "" : "s"
                } with a balance`}
          </p>
        </Link>
        <Link
          href="/owner/fees?tab=dues"
          className={`rounded-ctl border px-3.5 py-3 ${
            hasOverdue ? "border-late/40 bg-late-soft" : "border-line bg-paper"
          }`}
        >
          <p className={`text-[12px] ${hasOverdue ? "text-late" : "text-ink-3"}`}>Overdue</p>
          <p
            className={`mt-1 font-display text-[20px] font-semibold leading-none tabular-nums ${
              hasOverdue ? "text-late" : ""
            }`}
          >
            {formatINR(data.money.overduePaise)}
          </p>
          <p className={`mt-1 text-[11.5px] ${hasOverdue ? "text-late" : "text-ink-3"}`}>
            {hasOverdue
              ? `${overdueCount} past the due date`
              : "Nothing past due"}
          </p>
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatCard
          label={`Active ${membersOther}`}
          value={data.activeMemberCount}
          href="/owner/members"
          tone="paper"
        />
        <StatCard
          label="Attendance this week"
          value={data.attendanceThisWeekPct === null ? "—" : `${data.attendanceThisWeekPct}%`}
          href="/owner/reports"
          tone="paper"
        />
        <StatCard
          label={`${titleCase(batchesOther)} running`}
          value={data.activeBatchCount}
          href="/owner/programs"
          tone="paper"
        />
      </div>

      {/* 6 — the trend charts with their day-level drill-through.
          Desktop uses the lazily loaded ECharts island; mobile keeps
          server SVG so no chart library ships to a phone. */}
      {charts ? (
        <DashboardTrends attendance={charts.attendance} collections={charts.collections} />
      ) : null}

      {/* W1-6 — consolidated per-facility view, shown only when the
          tenant has more than one facility. In the All-facilities view
          this is the comparison the market's multi-location products
          lead with. */}
      {data.facilityBreakdown.length > 1 ? (
        <section className="mt-7">
          <h2 className="font-display text-[15px] font-semibold mb-2.5">
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
    </main>
  );
}
