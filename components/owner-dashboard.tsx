import Link from "next/link";
import { AlertTriangle, CalendarRange, ClipboardList, Clock, ListChecks, Receipt, Users } from "lucide-react";
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

// S4 (Owner home) + C02 (docs/audits/2026-10-09-role-content-permission-audit.md §9).
//
// C02: the screen now leads with money and decisions, in that order —
// a billing hero (collected today / outstanding / overdue, every figure
// from the dashboard service's real daily-collections and fees-overview
// reads), then the needs-attention list (cash discrepancies, overdue
// fees, overdue follow-ups, register-not-started) — with the register
// completion progress demoted below both. Register management is coach
// execution detail; the owner's first question is money.
//
// Honesty rules kept from S4: zeroes state themselves ("No payments
// recorded today yet", "No dues outstanding", "Nothing past due"), a
// null attendance percentage is "—", and no profit/cost figure exists
// anywhere because no such data exists in the schema. The section that
// renders batch capacity lanes is titled for what it is (batches
// today), not a facilities heading.
export function OwnerDashboard({
  data,
  branding,
  terminology,
  charts,
  showOnboarding = true,
}: {
  data: OwnerDashboardData;
  branding: BrandingData;
  terminology: TerminologyState;
  charts?: {
    attendance: TrendPoint[] | null;
    collections: CollectionsSeries | null;
  };
  showOnboarding?: boolean;
}) {
  const dayLabel = new Date(`${data.today}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "long",
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

  return (
    <main className="px-5 pt-6 pb-8">
      <div className="flex items-center gap-3 pb-4">
        <div className="flex-none">
          <TenantMark initials={branding.initials} accent={branding.accent} size={44} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[19px] font-semibold leading-tight">{displayName}</h1>
          <p className="text-[12.5px] text-ink-3">{dayLabel}</p>
        </div>
        {/* P1-4 (mobile UX audit): sign-out was three taps deep in
            Settings. The header is the one-tap surface every other role
            already has (Ops header, coach/reception Me tabs). */}
        <form action={logoutTenantAction} className="flex-none">
          <button
            type="submit"
            className="rounded-ctl border border-line bg-paper px-3 min-h-[44px] text-[12.5px] font-medium text-ink-2"
          >
            Sign out
          </button>
        </form>
      </div>

      {/* C02 — money/decision hero, the dominant element. All three
          figures are the dashboard service's real billing reads
          (getDailyCollection for today's captured payments,
          getFeesOverview for outstanding/overdue), already scoped to
          the caller's facilities and access boundary. Overdue switches
          to the late (red) money tone only when there is something
          overdue — colour means money state, never decoration.
          The figure is the gross captured total, titled "Payments
          recorded today"; the Fees hub's "Collected this period" is
          net of reversals — the two screens must not read as the same
          figure.
          Both sub-card links override the global focus ring with
          `outline-paper`: the default --focus-ring fails 3:1 against
          marine, paper passes. */}
      <div className="rounded-card bg-marine px-5 py-5 text-paper">
        <p className="text-[12.5px] font-medium text-paper/70">
          Payments recorded today
        </p>
        <p className="mt-1.5 font-display text-[34px] font-semibold tracking-tight leading-none tabular-nums">
          {formatINR(data.money.collectedTodayPaise)}
        </p>
        <p className="mt-1 text-[13px] text-paper/80">
          {data.money.collectedTodayCount === 0
            ? "No payments recorded today yet"
            : `${data.money.collectedTodayCount} payment${
                data.money.collectedTodayCount === 1 ? "" : "s"
              } recorded`}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href="/owner/fees?tab=dues"
            className="block rounded-ctl bg-paper/10 px-3.5 py-3 focus-visible:outline-paper"
          >
            <p className="text-[12px] text-paper/70">Outstanding</p>
            <p className="mt-1 font-display text-[18px] font-semibold leading-none tabular-nums">
              {formatINR(data.money.outstandingPaise)}
            </p>
            <p className="mt-1 text-[11.5px] text-paper/70">
              {data.money.dueInvoiceCount === 0
                ? "No dues outstanding"
                : `${data.money.dueInvoiceCount} invoice${
                    data.money.dueInvoiceCount === 1 ? "" : "s"
                  } with a balance`}
            </p>
          </Link>
          <Link
            href="/owner/fees?tab=dues"
            className={`block rounded-ctl px-3.5 py-3 focus-visible:outline-paper ${
              hasOverdue ? "bg-late-soft text-late" : "bg-paper/10"
            }`}
          >
            <p className={`text-[12px] ${hasOverdue ? "text-late" : "text-paper/70"}`}>
              Overdue
            </p>
            <p className="mt-1 font-display text-[18px] font-semibold leading-none tabular-nums">
              {formatINR(data.money.overduePaise)}
            </p>
            <p className={`mt-1 text-[11.5px] ${hasOverdue ? "text-late" : "text-paper/70"}`}>
              {hasOverdue
                ? `${overdueCount} past the due date`
                : "Nothing past due"}
            </p>
          </Link>
        </div>
      </div>

      {/* C02 — decisions before execution: cash discrepancies and the
          unresolved owner decisions (overdue fees, follow-ups,
          register not started) sit directly under the money hero, above
          the register-completion detail below. */}
      <SectionHeader
        className="mt-7 mb-2.5"
        title="Needs you today"
        trailing={
          data.needsAttention.length > 0 ? (
            <CountChip count={data.needsAttention.length} tone="warn" />
          ) : undefined
        }
      />
      {data.needsAttention.length === 0 ? (
        <div className="rounded-ctl border border-line bg-paper px-4 py-6 text-center">
          <p className="text-[13px] text-ink-3">Nothing needs attention right now.</p>
        </div>
      ) : (
        <ul>
          {data.needsAttention.map((item, i) => (
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
      )}

      {/* Register completion — demoted below the money/decision layer
          (C02): this is detail the owner can check, not the first
          thing the screen should say. Null (not 0%) when nothing is
          scheduled today at all; that's a different, truthful state,
          not a fabricated zero.

          F-2 (2026-09-13 Indian-user UX audit): the "nothing
          scheduled" branch used to key off todayTotal (sum of
          enrolments), so a day with a real session but no one enrolled
          read "Nothing scheduled today" directly above a lane listing
          that same session. "Is anything scheduled" is todayLanes,
          full stop; enrolment is a separate fact stated in its own
          branch. */}
      <div className="mt-4 rounded-card border border-line bg-paper px-5 py-4">
        <p className="text-[12.5px] font-medium text-ink-3">Today&apos;s registers</p>
        {data.todaysLanes.length === 0 ? (
          <p className="mt-1.5 text-[15px] font-medium">Nothing scheduled today</p>
        ) : data.todayTotal > 0 ? (
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

      {/* W1-6 continuation — trend charts with day-level
          drill-through. Desktop uses the lazily loaded ECharts island;
          mobile keeps server SVG so no chart library ships to a phone. */}
      {charts ? (
        <DashboardTrends attendance={charts.attendance} collections={charts.collections} />
      ) : null}

      {/* W1-4 (docs/role-surfaces-plan.md): resolves the deferred F26
          owner-nav question without a fifth bottom-nav item. Desktop
          now carries these in the sidebar (grouped Operations /
          Insights), so this grid is the below-lg access path only —
          a phone keeps Fees, Enquiries, Programs/Sessions and Staff
          one tap from Home. The Onboarding tile retires itself once
          every setup step is complete (kept retrievable in Settings →
          Setup), matching the SaaSUI/UX-Planet checklist guidance. */}
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
            className="flex items-center gap-2.5 rounded-ctl bg-paper border border-line px-3.5 min-h-[56px] py-3"
          >
            <link.icon size={16} className="text-ink-3 flex-none" aria-hidden="true" />
            <span className="text-[13.5px] font-medium">{link.label}</span>
          </Link>
        ))}
      </div>

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

      {/* C02 — the old facilities heading is gone: this section renders
          each batch's capacity lane, so it says so. */}
      <SectionHeader
        className="mt-7 mb-2.5"
        title={`${titleCase(batchesOther)} today`}
      />
      {data.todaysLanes.length === 0 ? (
        <div className="rounded-ctl border border-line bg-paper px-4 py-6 text-center">
          <p className="text-[13px] font-medium">No {sessionsOther} today</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Nothing is scheduled for today.
          </p>
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
    </main>
  );
}
