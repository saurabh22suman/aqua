import Link from "next/link";
import { StaffWorkdayLink } from "@/components/staff-ui/staff-workday-link";
import { getScheduleAction } from "@/lib/actions/coach";
import { formatTimeIST, formatWeekdayDateIST } from "@/lib/time/tz";
import { requireCoach } from "@/lib/auth/surface-guard";
import { STAFF_CARD, StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";
import { registerState } from "@/components/staff-ui/register-state";
import { buttonClasses } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";

export default async function CoachSchedulePage({ searchParams }: {
  searchParams?: Promise<{ day?: string }>;
}) {
  const ctx = await requireCoach();
  const [schedule, params] = await Promise.all([
    getScheduleAction({}).catch(() => null),
    searchParams,
  ]);

  if (!schedule) {
    return (
      <StaffPage>
        <StaffPageHeader title="Schedule" />
        <StaffWorkdayLink ctx={ctx} href="/coach/workday" />
        <section className={`mt-4 space-y-2 p-4 ${STAFF_CARD}`}>
          <p role="alert" className="text-sm">Could not load your assigned sessions.</p>
          <a href={typeof params?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? `/coach/schedule?day=${params.day}` : "/coach/schedule"}
            className={buttonClasses({ size: "sm" })}>Retry schedule</a>
        </section>
      </StaffPage>
    );
  }

  const { days } = schedule;
  const selected = days.find((day) => day.date === params?.day);
  const workingDays = days.filter((day) => day.sessions.length > 0);
  const now = Date.now();
  const next = workingDays.flatMap((day) => day.sessions).find((session) => new Date(session.endsAt).getTime() > now);
  const shown = selected ? [selected] : workingDays;

  return (
    <StaffPage>
      <StaffPageHeader title="Schedule" meta={`Your assigned sessions · Next ${days.length} ${days.length === 1 ? "day" : "days"}`} />

      {next && !selected ? (
        <section aria-labelledby="coach-next-label" className={`mt-4 p-4 ${STAFF_CARD}`}>
          <h2 id="coach-next-label" className="text-sm font-semibold">{new Date(next.startsAt).getTime() <= now ? "Session in progress" : "Next assigned session"}</h2>
          <p className="mt-1 break-words text-xl font-bold">{next.batchName}</p>
          <p className="text-sm text-ink-2">{formatWeekdayDateIST(next.sessionDate)} · {formatTimeIST(next.startsAt)}</p>
          <p className="mt-1 break-words text-sm text-ink-2">{next.locationName ?? "Venue not recorded"}</p>
          <Link className={buttonClasses({ variant: "primary", size: "sm", className: "mt-3" })}
            href={`/coach/register/${next.id}?day=${next.sessionDate}`}>Open next register</Link>
        </section>
      ) : null}

      <nav aria-label="Schedule days" className="mt-4 flex max-w-full items-stretch gap-1.5 overflow-x-auto p-1">
        <Link href="/coach/schedule" aria-current={!selected ? "page" : undefined}
          className={buttonClasses({ size: "sm", variant: !selected ? "primary" : "secondary", className: "shrink-0" })}>Week</Link>
        {days.map((day) => {
          const label = formatWeekdayDateIST(day.date);
          const dayOfWeek = label.split(",")[0];
          return (
            <Link key={day.date} href={`/coach/schedule?day=${day.date}`} aria-current={selected === day ? "page" : undefined}
              aria-label={`${label}, ${day.sessions.length} ${day.sessions.length === 1 ? "session" : "sessions"}`}
              className={buttonClasses({
                size: "sm",
                variant: selected === day ? "primary" : "secondary",
                className: "shrink-0 flex-col gap-0 !px-2 leading-tight",
              })}>
              <span className="text-[11px]">{dayOfWeek}</span>
              <span className="font-semibold tabular-nums">{Number(day.date.slice(-2))}</span>
              <span aria-hidden="true" className="text-[10px] tabular-nums">{day.sessions.length}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-5 space-y-4">
        {!shown.length ? <p className={`p-4 text-sm text-ink-2 ${STAFF_CARD}`}>No assigned sessions this week.</p> : null}
        {shown.map((day) => (
          <section key={day.date} aria-label={formatWeekdayDateIST(day.date)}>
            <h2 className="text-base font-semibold">{formatWeekdayDateIST(day.date)}</h2>
            {!day.sessions.length ? (
              <p className={`mt-2 p-4 text-sm text-ink-2 ${STAFF_CARD}`}>Nothing scheduled for this day.</p>
            ) : (
              <ul className={`mt-2 divide-y divide-line ${STAFF_CARD}`}>
                {day.sessions.map((session) => {
                  const state = registerState(session.marked, session.total);
                  const verb = state.label === "Register complete" ? "Review register" : "Open register";
                  const tone = state.label === "Register complete" ? "good" : state.label === "Register open" ? "warn" : "neutral";
                  return (
                    <li key={session.id}>
                      <Link href={`/coach/register/${session.id}?day=${day.date}`}
                        aria-label={`${verb} for ${session.batchName} at ${formatTimeIST(session.startsAt)}`}
                        className="block p-4 transition-colors hover:bg-deck/50 active:bg-deck motion-reduce:transition-none"
                        data-testid="coach-schedule-session">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="break-words font-semibold">
                              <span className="block text-sm font-normal tabular-nums text-ink-2">{formatTimeIST(session.startsAt)}</span>{" "}
                              {session.batchName}
                            </h3>
                            <p className="break-words text-sm text-ink-2">{session.locationName ?? "Venue not recorded"}</p>
                          </div>
                          <StatusBadge tone={tone}>{state.label}</StatusBadge>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                          {session.total > 0 ? <span className="tabular-nums text-ink-2">{state.detail}</span> : null}
                          <span className="inline-flex items-center gap-1 font-medium text-[var(--accent-ink)]">{verb} <OwnerIcon name="chevron" size={16} /></span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
      <StaffWorkdayLink ctx={ctx} href="/coach/workday" />
    </StaffPage>
  );
}
