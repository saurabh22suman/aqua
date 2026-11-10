import Link from "next/link";
import { getScheduleAction } from "@/lib/actions/coach";
import { formatTimeIST, formatWeekdayDateIST } from "@/lib/time/tz";
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

// Coach schedule — the next seven days of the sessions this coach is
// assigned to. The same register words as Today: completion is marks
// recorded out of the people expected, never attendance.
export default async function CoachSchedulePage() {
  await requireCoach();
  const { days } = await getScheduleAction({});

  return (
    <StaffPage>
      <StaffPageHeader
        title="Schedule"
        meta={`Next ${days.length} ${days.length === 1 ? "day" : "days"}`}
      />

      <div className="mt-5 space-y-5">
        {days.map((d) => {
          const dateLabel = formatWeekdayDateIST(d.date);
          return (
            <section key={d.date}>
              <h2 className="text-[12px] font-medium text-ink-3">{dateLabel}</h2>
              {d.sessions.length === 0 ? (
                <p className="mt-1 text-[13px] text-ink-3">Nothing scheduled</p>
              ) : (
                <ul className={`mt-2 divide-y divide-line ${STAFF_CARD}`}>
                  {d.sessions.map((s) => {
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
                          className="block px-4 py-3 transition-colors duration-150 hover:bg-deck/50 active:bg-deck"
                          data-testid="coach-schedule-session"
                        >
                          <div className="flex items-baseline justify-between gap-2.5">
                            <span className="min-w-0 flex-1 break-words text-[14px] font-medium leading-snug text-ink">
                              {formatTimeIST(s.startsAt)} {s.batchName}
                            </span>
                            <span className="flex-none text-[12px] text-ink-3 tabular-nums">
                              {state.detail}
                            </span>
                          </div>
                          {s.total > 0 ? (
                            <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-deck">
                              <div
                                className={`h-full rounded-pill ${fill}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          ) : null}
                          <div className="mt-2 flex items-center justify-between gap-3">
                            {s.total > 0 ? (
                              <span className="text-[12px] font-medium text-ink-2">
                                {state.label}
                              </span>
                            ) : null}
                            <OwnerIcon
                              name="chevron"
                              size={16}
                              className="ml-auto flex-none text-ink-3"
                            />
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </StaffPage>
  );
}
