import Link from "next/link";
import { getScheduleAction } from "@/lib/actions/coach";
import { formatTimeIST, formatWeekdayDateIST } from "@/lib/time/tz";
import { requireCoach } from "@/lib/auth/surface-guard";

export default async function CoachSchedulePage() {
  await requireCoach();
  const { days } = await getScheduleAction({});

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[22px] font-semibold text-marine">Schedule</h1>
      <p className="mt-1 text-[13px] text-ink-3">Next {days.length} days</p>

      <ul className="mt-4 space-y-4">
        {days.map((d) => {
          const dateLabel = formatWeekdayDateIST(d.date);
          return (
            <li key={d.date}>
              <p className="text-[12px] font-medium text-ink-3">{dateLabel}</p>
              {d.sessions.length === 0 ? (
                <p className="mt-1 text-[13px] text-ink-3">No sessions</p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {d.sessions.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/coach/register/${s.id}`}
                        className="block bg-paper rounded-card border border-line p-3"
                      >
                        <div className="flex justify-between items-baseline">
                          <span className="text-[14px] font-display font-semibold">
                            {formatTimeIST(s.startsAt)} {s.batchName}
                          </span>
                          <span className="text-[12.5px] text-ink-3">
                            {s.total === 0 ? "No one enrolled" : `${s.marked} / ${s.total}`}
                          </span>
                        </div>
                        {s.total > 0 ? (
                          <div className="mt-2 h-1.5 rounded-pill bg-deck overflow-hidden">
                            <div
                              className={`h-full rounded-pill ${
                                s.marked === 0 ? "bg-water" : s.marked / s.total < 0.5 ? "bg-warn" : "bg-good"
                              }`}
                              style={{ width: `${Math.round((s.marked / s.total) * 100)}%` }}
                            />
                          </div>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}