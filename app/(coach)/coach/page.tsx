import Link from "next/link";
import { ArrowRight, CalendarClock, ChevronRight, Clock } from "lucide-react";
import { getCoachHomeAction } from "@/lib/actions/coach";
import { todayInZone } from "@/lib/time/tz";
import { requireCoach } from "@/lib/auth/surface-guard";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDay(iso: string): string {
  // e.g. "Mon 9 Sep"
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

// Days between two yyyy-mm-dd dates, in calendar days. Both sides are
// already in the tenant's timezone (today from todayInZone, next's
// sessionDate from the sessions table which stores local-zone dates),
// so the difference is the calendar-day distance the empty-state
// card needs to choose its verb.
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

// Coach home. Today only. One dominant element: today's session
// cards, each a lane strip with marking progress. The week's grid
// lives at /coach/schedule; the roster lookup lives at /coach/members.
// Home is for acting in the next 10 minutes — anything else is
// reference, and reference has its own tab.
export default async function CoachTodayPage() {
  await requireCoach();
  const { sessions, next } = await getCoachHomeAction();
  const today = todayInZone("Asia/Kolkata");

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[22px] font-semibold text-marine">Today</h1>

      {sessions.length === 0 ? (
        next ? (
          // Empty today, next session within the 7-day window. Verb
          // and target match the distance: "Open register" only when
          // the next session is today or tomorrow (the coach would
          // actually go mark it now); "Show on schedule" further out,
          // because tapping "Open register" for Wednesday on a Sunday
          // would land the coach on a register they have no business
          // being on yet.
          (() => {
            const ahead = daysBetween(today, next.sessionDate!);
            const isSoon = ahead <= 1;
            return (
              <section className="mt-6">
                <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
                  <Clock size={15} className="text-ink-3" />
                  Up next
                </h2>
                <Link
                  href={isSoon ? `/coach/register/${next.id}` : "/coach/schedule"}
                  className="mt-2 block rounded-card bg-water text-paper p-4 transition-colors duration-150 active:bg-water/90"
                  data-testid="coach-up-next"
                >
                  <p className="text-[12.5px] text-paper/70 font-medium">
                    {isSoon ? (ahead === 0 ? "Later today" : "Tomorrow") : shortDay(next.sessionDate!)}
                    <span className="ml-1.5 text-paper/60">
                      {next.sessionDate}
                    </span>
                  </p>
                  <p className="mt-1 font-display text-[22px] font-semibold tracking-tight leading-tight">
                    {timeOf(next.startsAt)} {next.batchName}
                  </p>
                  <p className="mt-1.5 text-[12.5px] text-paper/70 flex items-center gap-1.5">
                    <CalendarClock size={12} className="flex-none" />
                    {next.total} enrolled
                  </p>
                  <p className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium">
                    {isSoon ? "Open register" : "Show on schedule"}
                    <ArrowRight size={14} />
                  </p>
                </Link>
              </section>
            );
          })()
        ) : (
          // Nothing today AND nothing in the next 7 days. A coach
          // with no upcoming batches at all is rare but real (a coach
          // whose assignment just changed). The verb-CTA convention
          // from the design doc wants an actionable next step; the
          // only honest one here is to surface the absence and point
          // at the owner.
          <div className="mt-6 text-center py-12" data-testid="coach-home-empty">
            <p className="text-[15px] font-medium">No sessions scheduled</p>
            <p className="mt-2 text-[13px] text-ink-3">
              Nothing today or in the next week. Check with the owner — you may not be on a batch yet.
            </p>
            <Link
              href="/coach/schedule"
              className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--accent-ink)]"
            >
              Open schedule
              <ChevronRight size={14} />
            </Link>
          </div>
        )
      ) : (
        <ul className="mt-6 space-y-4">
          {sessions.map((s) => {
            const pct = s.total > 0 ? Math.round((s.marked / s.total) * 100) : 0;
            const fill = s.marked === 0 ? "bg-water" : pct < 50 ? "bg-warn" : "bg-good";
            return (
              <li key={s.id}>
                <Link
                  href={`/coach/register/${s.id}`}
                  className="block bg-paper rounded-card border border-line p-4 transition-colors duration-150 active:bg-water-soft"
                  data-testid="coach-today-session"
                >
                  <div className="flex justify-between items-baseline mb-2">
                    <span className="text-[15px] font-display font-semibold">
                      {timeOf(s.startsAt)} {s.batchName}
                    </span>
                    <span className="text-[13px] text-ink-3">
                      {s.marked} / {s.total}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-pill bg-deck overflow-hidden">
                    <div
                      className={`h-full rounded-pill ${fill}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
