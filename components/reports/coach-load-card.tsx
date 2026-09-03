import type { CoachLoadRow } from "@/lib/services/owner-reports";

// Phase 4.6 — coach load. Distinct sessions per coach-staff
// in the period, plus distinct members coached. Reads like a
// service board the owner uses to spot under-utilised coaches.

export function CoachLoadCard({ rows }: { rows: CoachLoadRow[] }) {
  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">Coach load</h2>
        <span className="text-[12px] text-ink-3">{rows.length} coaches</span>
      </header>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No sessions were assigned to a coach in this period.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.coachStaffId} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
              <span className="min-w-0 truncate">{r.coachName}</span>
              <span className="flex-none text-ink-3 text-[12px] tabular-nums">
                {r.sessionCount} {r.sessionCount === 1 ? "session" : "sessions"} ·{" "}
                {r.distinctMembers} {r.distinctMembers === 1 ? "person" : "people"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
