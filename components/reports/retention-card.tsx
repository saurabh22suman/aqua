import type { RetentionReport } from "@/lib/services/owner-reports";

// Phase 4.5 — the owner's ATTENDANCE RECORDS SUMMARY. Aggregate-only
// by design: the headline is a number, never a list.
//
// The wording was approved by the human on 30 October 2026
// (docs/audits/staging-blockers-20261029/d-workflows/dot-three-
// 20261030/HUMAN-APPROVED-RETENTION-DEFINITION.md):
//
//   * "Attendance records to review" — an aggregate operational
//     summary of the members who were here for the whole period and
//     have NO attendance record in it.
//   * A RECORD is any recorded mark — present, late OR absent.
//   * A member with no mark is UNKNOWN. It is never relabelled
//     absent, never a churn prediction and never a risk score.
//
// The rule lives in lib/services/retention-report-query.ts, so the
// report and this card cannot disagree about what the numbers mean.
//
// The cohort is stated on the card, because the number is only
// meaningful next to it: active members who joined before the period
// started, within the caller's own locations.

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
          <h2 className="font-display text-[16px] font-semibold">
            Attendance records to review
          </h2>
          <span className="text-[12px] text-ink-3">last 30 days</span>
        </header>
        <div className="mt-3 rounded-ctl bg-deck px-3 py-3">
          <p className="text-[14px] font-medium">Not enough attendance history</p>
          <p className="mt-1 text-[12px] text-ink-3 leading-snug">
            {sessionsInWindow > 0
              ? `No ${memberLabel} had been here for the whole period yet, so there are no records to review.`
              : `No sessions ran in this period, so there is nothing to review yet.`}
          </p>
        </div>
        <p className="mt-3 text-[12px] text-ink-3 leading-snug">
          Counts only — no member names and no individual scores.
        </p>
      </article>
    );
  }

  // The with-record count is DERIVED from the cohort: the eligible
  // members minus the members without a record. It is deliberately not
  // the legacy `membersWithPartialLast30` field — that one measures
  // members with one to three marks, a different thing, and showing it
  // here would put a partial-attendance proxy on screen as if it were
  // the attendance count.
  const withRecords = Math.max(0, eligibleMemberCount - row.memberCountAtRisk);

  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[16px] font-semibold">
          Attendance records to review
        </h2>
        <span className="text-[12px] text-ink-3">last 30 days</span>
      </header>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-ctl bg-deck px-3 py-3">
          <p className="font-display text-[22px] font-semibold tracking-tight">
            {row.memberCountAtRisk}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">
            {row.memberCountAtRisk === 1
              ? `${memberLabelOne} with no attendance record`
              : `${memberLabel} with no attendance records`}
          </p>
        </div>
        <div className="rounded-ctl bg-deck px-3 py-3">
          <p className="font-display text-[22px] font-semibold tracking-tight">
            {withRecords}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">
            {withRecords === 1
              ? `${memberLabelOne} with an attendance record`
              : `${memberLabel} with attendance records`}
          </p>
        </div>
        <div className="rounded-ctl bg-deck px-3 py-3">
          <p className="font-display text-[22px] font-semibold tracking-tight">
            {eligibleMemberCount}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">
            {eligibleMemberCount === 1
              ? `${memberLabelOne} active for the period`
              : `${memberLabel} active for the period`}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-ink-3 leading-snug">
        Counts active {memberLabel} who joined before this period started.
        Any attendance mark counts as a record — present, late or absent.
        A {memberLabelOne} with no mark has no record; that is not counted
        as absent.
      </p>
      <p className="mt-2 text-[12px] text-ink-3 leading-snug">
        Counts only — no member names and no individual scores.
      </p>
    </article>
  );
}
