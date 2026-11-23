import { StaffWorkdayLink } from "@/components/staff-ui/staff-workday-link";
import Link from "next/link";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { guidePreferenceKey } from "@/components/onboarding/guide-preference-key";
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
  StaffSection,
} from "@/components/staff-ui/staff-page";
import {
  registerProgressPercent,
  registerState,
} from "@/components/staff-ui/register-state";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { CountChip } from "@/components/ui/CountChip";
import { buttonClasses } from "@/components/ui/Button";
import { OFFLINE_SYNC_ENABLED } from "@/lib/feature-flags";

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

function stateTone(marked: number, total: number): StatusTone {
  if (total <= 0) return "neutral";
  if (marked >= total) return "good";
  return marked === 0 ? "water" : "warn";
}

// Coach home. Today only. The day's assigned registers are the one
// working list; the week's grid lives at /coach/schedule and the
// assigned roster at /coach/members. Register state is completion —
// marks recorded out of the people expected — never attendance.
//
// The first card is an operational brief: the next register that still
// needs work, its true completion, and the one action that resolves it.
// The full day stays below so a coach can see every register at once.
export default async function CoachTodayPage() {
  const ctx = await requireCoach();
  const home = await getCoachHomeAction().catch(() => null);
  const today = todayInZone("Asia/Kolkata");
  if (!home) {
    const retryHref = "/coach";
    return (
      <StaffPage>
        <StaffPageHeader title="Today" meta={formatFullDateIST(today)} />
        <StaffWorkdayLink ctx={ctx} href="/coach/workday" />
        <section aria-labelledby="coach-registers-unavailable" className={`mt-5 p-4 ${STAFF_CARD}`}>
          <h2 id="coach-registers-unavailable" className="text-[17px] font-semibold text-ink">Registers unavailable</h2>
          <p role="alert" className="mt-1 text-[13px] text-ink-2">Could not load today&apos;s assigned sessions.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={retryHref} className={buttonClasses({ variant: "primary", size: "sm" })}>Retry today&apos;s registers</a>
            <Link href="/coach/schedule" className={buttonClasses({ variant: "secondary", size: "sm" })}>Open schedule</Link>
          </div>
        </section>
      </StaffPage>
    );
  }

  const { sessions, next } = home;
  const markedTotal = sessions.reduce((n, s) => n + s.marked, 0);
  const expectedTotal = sessions.reduce((n, s) => n + s.total, 0);
  const openSessions = sessions.filter(
    (s) => s.total > 0 && s.marked < s.total,
  );
  const focus =
    openSessions[0] ??
    sessions.find((s) => s.total === 0) ??
    sessions[0] ??
    null;
  const otherSessions = sessions.filter((session) => session.id !== focus?.id);
  const focusUpcoming = focus !== null && new Date(focus.startsAt).getTime() > Date.now();
  const allComplete =
    sessions.length > 0 &&
    sessions.every((s) => s.total > 0 && s.marked >= s.total);

  return (
    <StaffPage>
      <StaffPageHeader
        title="Today"
        meta={formatFullDateIST(today)}
        action={
          sessions.length > 0 ? (
            <CountChip
              count={sessions.length}
              label={sessionNoun(sessions.length)}
              tone={allComplete ? "neutral" : "warn"}
            />
          ) : undefined
        }
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
              <section className="mt-5" aria-labelledby="coach-up-next-title">
                <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink">
                  <OwnerIcon name="calendar" size={16} className="text-ink-3" />
                  Up next
                </h2>
                <Link
                  href={isSoon ? `/coach/register/${next.id}` : `/coach/schedule?day=${encodeURIComponent(next.sessionDate!)}`}
                  className={`mt-2 block ${STAFF_CARD} p-4 transition-colors duration-150 active:bg-deck motion-reduce:transition-none`}
                  data-testid="coach-up-next"
                >
                  <p className="text-[12px] font-medium text-ink-3">
                    {isSoon ? (ahead === 0 ? "Later today" : "Tomorrow") : "Next week"}
                    <span className="ml-1.5">
                      · {formatWeekdayDateIST(next.sessionDate!)}
                    </span>
                  </p>
                  <div className="mt-1 flex items-start justify-between gap-3">
                    <h3
                      id="coach-up-next-title"
                      className="min-w-0 break-words text-[20px] font-medium leading-tight tracking-[-0.01em] text-ink"
                    >
                      {formatTimeIST(next.startsAt)} · {next.batchName}
                    </h3>
                    <StatusBadge tone={isSoon ? "water" : "neutral"}>
                      {isSoon ? "Register" : "Scheduled"}
                    </StatusBadge>
                  </div>
                  {next.locationName ? (
                    <p className="mt-1 break-words text-[12.5px] text-ink-3">
                      {next.locationName}
                    </p>
                  ) : null}
                  <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ink-2">
                    <OwnerIcon name="members" size={14} className="flex-none" />
                    {next.total} enrolled
                  </p>
                  <span className="mt-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-[var(--accent-ink)]">
                    {isSoon ? "Open register" : "Show on schedule"}
                    <OwnerIcon name="chevron" size={14} />
                  </span>
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
          {focus ? (
            <section
              className={`mt-5 overflow-hidden ${STAFF_CARD}`}
              aria-labelledby="coach-brief-title"
              data-testid="coach-home-brief"
            >
              <div className="p-4" data-testid="coach-today-session">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-ink-3">
                      {allComplete ? "Today's registers" : focusUpcoming ? "Next scheduled class" : "Next to mark"}
                    </p>
                    <h2
                      id="coach-brief-title"
                      className="mt-1 break-words text-[20px] font-medium leading-tight tracking-[-0.01em] text-ink"
                    >
                      {allComplete
                        ? "All registers complete"
                        : `${formatTimeIST(focus.startsAt)} · ${focus.batchName}`}
                    </h2>
                    {allComplete ? (
                      <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
                        {sessions.length} {sessionNoun(sessions.length)} ·{" "}
                        {markedTotal} of {expectedTotal} marks recorded
                      </p>
                    ) : focus.locationName ? (
                      <p className="mt-1 break-words text-[12.5px] leading-snug text-ink-3">
                        {focus.locationName}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge
                    tone={
                      allComplete
                        ? "good"
                        : stateTone(focus.marked, focus.total)
                    }
                  >
                    {allComplete
                      ? "Complete"
                      : registerState(focus.marked, focus.total).label}
                  </StatusBadge>
                </div>

                {!allComplete ? (
                  <>
                    <div className="mt-3 flex items-baseline justify-between gap-3">
                      <span className="text-[12.5px] font-medium text-ink-2">
                        {registerState(focus.marked, focus.total).detail}
                      </span>
                      <span className="text-[12px] text-ink-3">
                        Register completion
                      </span>
                    </div>
                    {focus.total > 0 ? (
                      <div
                        className="mt-2 h-1.5 overflow-hidden rounded-pill bg-deck"
                        role="progressbar"
                        aria-label={`Register completion for ${focus.batchName}`}
                        aria-valuemin={0}
                        aria-valuemax={focus.total}
                        aria-valuenow={Math.min(focus.marked, focus.total)}
                      >
                        <div
                          className={`h-full rounded-pill ${
                            focus.marked === 0 ? "bg-water" : "bg-warn"
                          }`}
                          style={{
                            width: `${registerProgressPercent(focus.marked, focus.total)}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-2 text-[13px] text-ink-2">
                    {formatTimeIST(focus.startsAt)} · {focus.batchName}{focus.locationName ? ` · ${focus.locationName}` : ""}
                  </p>
                )}

                <Link
                  href={`/coach/register/${focus.id}`}
                  className={buttonClasses({
                    variant: "primary",
                    size: "md",
                    className: "mt-3 w-full",
                  })}
                >
                  {allComplete ? "Review register" : "Open register"}
                  <OwnerIcon name="chevron" size={16} />
                </Link>
                <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
                  A register records marks, not who attended. A blank row stays
                  unknown.
                </p>
                {OFFLINE_SYNC_ENABLED ? (
                  <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
                    Offline marks sync from the register when you reconnect. A
                    failed save stays visible there until it clears.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {otherSessions.length > 0 ? <StaffSection
            title="Other sessions today"
            meta={`${markedTotal} of ${expectedTotal} marks recorded`}
          >
            <ul className={`mt-2 divide-y divide-line ${STAFF_CARD}`}>
              {otherSessions.map((s) => {
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
                      className="block px-4 py-3.5 transition-colors duration-150 hover:bg-deck/50 active:bg-deck motion-reduce:transition-none"
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
          </StaffSection> : null}
          <Link href="/coach/schedule" className="mt-4 inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-water underline underline-offset-2">
            See weekly schedule
            <OwnerIcon name="chevron" size={14} />
          </Link>
        </>
      )}

      <StaffWorkdayLink ctx={ctx} href="/coach/workday" />
      <OptionalWorkspaceGuide
        key={guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey)}
        startCollapsed
        preferenceKey={guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey)}
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
    </StaffPage>
  );
}
