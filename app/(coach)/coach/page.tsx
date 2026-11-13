import Link from "next/link";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { getCoachHomeAction } from "@/lib/actions/coach";
import {
  formatFullDateIST,
  formatTimeIST,
  formatWeekdayDateIST,
  todayInZone,
} from "@/lib/time/tz";
import { requireCoach } from "@/lib/auth/surface-guard";
import {
  STAFF_CARD,
  StaffPage,
  StaffPageHeader,
} from "@/components/staff-ui/staff-page";
import {
  registerProgressPercent,
  registerState,
} from "@/components/staff-ui/register-state";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";

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

function sessionNoun(count: number): string {
  return count === 1 ? "session" : "sessions";
}

// Coach home. Today only. The day's assigned registers are the one
// working list; the week's grid lives at /coach/schedule and the
// assigned roster at /coach/members. Register state is completion —
// marks recorded out of the people expected — never attendance.
export default async function CoachTodayPage() {
  await requireCoach();
  const { sessions, next } = await getCoachHomeAction();
  const today = todayInZone("Asia/Kolkata");

  const markedTotal = sessions.reduce((n, s) => n + s.marked, 0);
  const expectedTotal = sessions.reduce((n, s) => n + s.total, 0);

  return (
    <StaffPage>
      <StaffPageHeader title="Today" meta={formatFullDateIST(today)} />
      <OptionalWorkspaceGuide
        startCollapsed
        title="Explore your coach home"
        intro="A quick look at this page, whenever you want it."
        regionLabel="Optional coach guide"
        itemLabel="Page feature"
        items={sessions.length > 0
          ? [{ key: "today", title: "Today's registers", detail: "Review the assigned sessions and their register progress below." }]
          : next
            ? [{ key: "next", title: "Up next", detail: "See your next session and its available link below." }]
            : [{ key: "empty", title: "No sessions scheduled", detail: "The page shows the empty schedule and a link to your schedule below." }]}
      />

      {sessions.length === 0 ? (
        next ? (
          // Empty today, next session within the 7-day window. Verb
          // and target match the distance: "Open register" only when
          // the next session is today or tomorrow (the coach would
          // actually go mark it now); "Show on schedule" further out,
          // because a future register is not the coach's to mark yet.
          (() => {
            const ahead = daysBetween(today, next.sessionDate!);
            const isSoon = ahead <= 1;
            return (
              <section className="mt-5">
                <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink">
                  <OwnerIcon name="calendar" size={16} className="text-ink-3" />
                  Up next
                </h2>
                <Link
                  href={isSoon ? `/coach/register/${next.id}` : "/coach/schedule"}
                  className={`mt-2 block ${STAFF_CARD} p-4 transition-colors duration-150 active:bg-deck`}
                  data-testid="coach-up-next"
                >
                  <p className="text-[12.5px] font-medium text-ink-3">
                    {isSoon ? (ahead === 0 ? "Later today" : "Tomorrow") : null}
                    <span className="ml-1.5">
                      {isSoon ? "· " : ""}
                      {formatWeekdayDateIST(next.sessionDate!)}
                    </span>
                  </p>
                  <p className="mt-1 text-[18px] font-medium leading-tight tracking-[-0.01em] text-ink">
                    {formatTimeIST(next.startsAt)} {next.batchName}
                  </p>
                  {next.locationName ? <p className="mt-1 break-words text-[12px] text-ink-3">{next.locationName}</p> : null}
                  <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-2">
                    <OwnerIcon name="members" size={14} className="flex-none" />
                    {next.total} enrolled
                  </p>
                  <p className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--accent-ink)]">
                    {isSoon ? "Open register" : "Show on schedule"}
                    <OwnerIcon name="chevron" size={14} />
                  </p>
                </Link>
              </section>
            );
          })()
        ) : (
          // Nothing today AND nothing in the next 7 days. A coach with
          // no upcoming batches at all is rare but real (a coach whose
          // assignment just changed). The only honest next step is to
          // surface the absence and point at the schedule.
          <div
            className={`mt-5 px-4 py-8 text-center ${STAFF_CARD}`}
            data-testid="coach-home-empty"
          >
            <p className="text-[15px] font-medium text-ink">No sessions scheduled</p>
            <p className="mt-2 text-[13px] leading-snug text-ink-3">
              Nothing today or in the next week. Check with the owner — you may
              not be on a batch yet.
            </p>
            <Link
              href="/coach/schedule"
              className="mt-4 inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-[var(--accent-ink)]"
            >
              Open schedule
              <OwnerIcon name="chevron" size={14} />
            </Link>
          </div>
        )
      ) : (
        <>
          <p className="mt-4 text-[13px] text-ink-2">
            {sessions.length} {sessionNoun(sessions.length)} · {markedTotal} of{" "}
            {expectedTotal} marked
          </p>

          <ul className={`mt-3 divide-y divide-line ${STAFF_CARD}`}>
            {sessions.map((s) => {
              const state = registerState(s.marked, s.total);
              const pct = registerProgressPercent(s.marked, s.total);
              const fill =
                state.label === "Register complete"
                  ? "bg-good"
                  : s.marked === 0
                    ? "bg-water"
                    : "bg-warn";
              return (
                <li key={s.id}>
                  <Link
                    href={`/coach/register/${s.id}`}
                    className="block px-4 py-3.5 transition-colors duration-150 hover:bg-deck/50 active:bg-deck"
                    data-testid="coach-today-session"
                  >
                    <div className="mb-2 flex items-baseline justify-between gap-2.5">
                      {/* The title BOUNDS itself and WRAPS: a long batch
                          name stays readable in full instead of running
                          into the count. The count never gives up its
                          width — it is the number the coach marked. */}
                      <span className="min-w-0 flex-1 break-words text-[15px] font-medium leading-snug text-ink">
                        {formatTimeIST(s.startsAt)} {s.batchName}
                        {s.locationName ? <span className="block text-[12px] font-normal text-ink-3">{s.locationName}</span> : null}
                      </span>
                      <span className="flex-none text-[12px] text-ink-3 tabular-nums">
                        {state.detail}
                      </span>
                    </div>
                    {s.total > 0 ? (
                      <div className="h-1.5 overflow-hidden rounded-pill bg-deck">
                        <div
                          className={`h-full rounded-pill ${fill}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    ) : null}
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      {s.total > 0 ? (
                        <span className="text-[12px] font-medium text-ink-2">
                          {state.label}
                        </span>
                      ) : null}
                      <span className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-[var(--accent-ink)]">
                        Open register
                        <OwnerIcon name="chevron" size={14} />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </StaffPage>
  );
}
