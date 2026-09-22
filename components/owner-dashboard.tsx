import Link from "next/link";
import { AlertTriangle, CalendarRange, ClipboardList, Clock, ListChecks, Receipt, Users } from "lucide-react";
import { AttentionRow } from "@/components/ui/AttentionRow";
import { CountChip } from "@/components/ui/CountChip";
import { LaneStrip } from "@/components/ui/LaneStrip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatCard } from "@/components/ui/StatCard";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";
import { TenantMark } from "@/components/branding/tenant-mark";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import { formatWallTime12h } from "@/lib/time/tz";
import { logoutTenantAction } from "@/lib/actions/tenant-auth";

// S4 (Owner home) — composition follows docs/sports-club-ui-direction.html's
// "Owner · home" mockup: one dominant hero, three stat chips, a
// reason-stated needs-attention list, then the lane strip (the same
// signature element components/register-board.tsx uses, reused here
// for batch capacity per DESIGN.md's "three reuses" note). The
// mockup's hero and one chip are money-shaped ("To collect ₹18,200",
// "₹82,450 Collected in Aug") — no money table exists in this
// codebase yet (C-28 through C-39 unbuilt), so those are replaced
// with today's real attendance-marking progress and a real member
// count. Never a rupee sign, never an invented number.
export function OwnerDashboard({
  data,
  branding,
  terminology,
}: {
  data: OwnerDashboardData;
  branding: BrandingData;
  terminology: TerminologyState;
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

      {/* Hero: today's attendance-marking progress across every batch —
          the honest substitute for the mockup's money figure. Null
          (not 0%) when nothing is scheduled today at all; that's a
          different, truthful state, not a fabricated zero.

          F-2 (2026-09-13 Indian-user UX audit): the "nothing
          scheduled" branch used to key off todayTotal (sum of
          enrolments), so a day with a real session but no one enrolled
          read "Nothing scheduled today" directly above a lane listing
          that same session. "Is anything scheduled" is todayLanes,
          full stop; enrolment is a separate fact stated in its own
          branch. */}
      <div className="rounded-card bg-marine px-5 py-5 text-paper">
        <p className="text-[12.5px] font-medium text-paper/70">Today&apos;s registers</p>
        {data.todaysLanes.length === 0 ? (
          <p className="mt-1.5 text-[15px] font-medium text-white">Nothing scheduled today</p>
        ) : data.todayTotal > 0 ? (
          <>
            <p className="mt-1.5 mb-1 font-display text-[38px] font-semibold tracking-tight leading-none">
              {todayPct}%
            </p>
            <p className="text-[13px] text-paper/80">
              {data.todayMarked} of {data.todayTotal} marked across {data.todaysLanes.length}{" "}
              {data.todaysLanes.length === 1 ? sessionsOne : sessionsOther}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[15px] font-medium text-white">
            {data.todaysLanes.length}{" "}
            {data.todaysLanes.length === 1 ? sessionsOne : sessionsOther} scheduled &middot; no{" "}
            {membersOther} enrolled yet
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatCard label={`Active ${membersOther}`} value={data.activeMemberCount} />
        <StatCard
          label="Attendance this week"
          value={data.attendanceThisWeekPct === null ? "—" : `${data.attendanceThisWeekPct}%`}
        />
        <StatCard label={`${titleCase(batchesOther)} running`} value={data.activeBatchCount} />
      </div>

      {/* W1-4 (docs/role-surfaces-plan.md): resolves the deferred F26
          owner-nav question without a fifth bottom-nav item — the
          operational screens the audit found buried (Enquiries,
          Programs/Sessions, Staff, Onboarding) get a one-tap grid
          here, where the owner already starts their day. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[
          { href: "/owner/fees", label: "Fees & payments", icon: Receipt },
          { href: "/owner/enquiries", label: "Enquiries", icon: ClipboardList },
          { href: "/owner/programs", label: "Programs & sessions", icon: CalendarRange },
          { href: "/owner/staff", label: "Staff", icon: Users },
          { href: "/owner/onboarding", label: "Onboarding", icon: ListChecks },
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
          lead with; member-scoped data only until Wave 2 gives batches
          a location. */}
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

      <SectionHeader
        className="mt-7 mb-2.5"
        title={`Today's ${resolveTerm(terminology, "facility", "other")}`}
      />
      {data.todaysLanes.length === 0 ? (
        <div className="rounded-ctl border border-line bg-paper px-4 py-6 text-center">
          <p className="text-[13px] font-medium">No {sessionsOther} today</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Nothing is scheduled for today across any batch.
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
