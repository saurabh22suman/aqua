import type { RetentionReport } from "@/lib/services/owner-reports";

// Phase 4.5 — retention view. Aggregate-only by design.
// Per scope § 7.1 (DPDP profiling restriction), risk-scoring an
// individual minor is out of scope; the headline is "X members
// at risk" — a number, not a list. Coach/owner reads it as a
// pulse: is the at-risk cohort growing, holding, shrinking.
//
// "At risk" definition: an active member WHO WAS A MEMBER FOR THE
// WHOLE WINDOW and whose attendance over the last 30 days is zero.
// Two facts have to hold before the view may say it (the rule lives
// in lib/services/owner-reports.ts, so the report and the dashboard
// cannot disagree):
//
//   * there was a chance — attendance-eligible sessions ran in the
//     window; and
//   * the member was around — they joined on or before the window
//     started.
//
// When either is missing the card says so instead of counting. A
// freshly seeded club has neither, and calling every swimmer "at
// risk" there was a false alarm, not a finding.

export function RetentionCard({
  report,
  memberLabel = "members",
  memberLabelOne = "member",
}: {
  report: RetentionReport;
  // The tenant's own word for a member ("swimmer" for a swim
  // academy). DESIGN.md §4: never hard-code the vocabulary.
  memberLabel?: string;
  memberLabelOne?: string;
}) {
  const { row, history, eligibleMemberCount, sessionsInWindow } = report;
  if (history === "insufficient") {
    return (
      <article className="bg-paper border border-line rounded-card p-4">
        <header className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-[15px] font-semibold">Retention</h2>
          <span className="text-[12px] text-ink-3">last 30 days</span>
        </header>
        <div className="mt-3 rounded-ctl bg-deck px-3 py-3">
          <p className="text-[14px] font-medium">Not enough attendance history</p>
          <p className="mt-1 text-[12px] text-ink-3 leading-snug">
            {sessionsInWindow > 0
              ? `No ${memberLabel} had been here for the whole period yet, so nobody can be called at risk.`
              : `No sessions ran in this period, so there is nothing to measure yet.`}
          </p>
        </div>
        <p className="mt-3 text-[12px] text-ink-3 leading-snug">
          Aggregate only. No per-member risk score — minors cannot be profiled under DPDP. Open the cohort manually if you want a name list.
        </p>
      </article>
    );
  }

  const pct = eligibleMemberCount > 0
    ? Math.round((row.memberCountAtRisk / eligibleMemberCount) * 100)
    : null;
  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">Retention</h2>
        <span className="text-[12px] text-ink-3">last 30 days</span>
      </header>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="rounded-ctl bg-deck px-3 py-3">
          <p className="font-display text-[22px] font-semibold tracking-tight">
            {row.memberCountAtRisk}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">
            {row.memberCountAtRisk === 1 ? `${memberLabelOne} at risk` : `${memberLabel} at risk`}
          </p>
        </div>
        <div className="rounded-ctl bg-deck px-3 py-3">
          <p className="font-display text-[22px] font-semibold tracking-tight">
            {pct === null ? "—" : `${pct}%`}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">Of eligible {memberLabel}</p>
        </div>
        <div className="rounded-ctl bg-deck px-3 py-3">
          <p className="font-display text-[22px] font-semibold tracking-tight">
            {eligibleMemberCount}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">Eligible {memberLabel}</p>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-ink-3 leading-snug">
        Aggregate only. No per-member risk score — minors cannot be profiled under DPDP. Open the cohort manually if you want a name list.
      </p>
    </article>
  );
}
