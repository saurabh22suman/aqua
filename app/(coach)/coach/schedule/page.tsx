import Link from "next/link";
import { getScheduleAction } from "@/lib/actions/coach";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export default async function CoachSchedulePage() {
  const { days } = await getScheduleAction({});

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[22px] font-semibold text-marine">Schedule</h1>
      <p className="mt-1 text-[13px] text-ink-3">Next {days.length} days</p>

      <ul className="mt-4 space-y-4">
        {days.map((d) => {
          const [y, m, day] = d.date.split("-").map(Number);
          const dateLabel = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-IN", {
            weekday: "short",
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          });
          return (
            <li key={d.date}>
              <p className="text-[12px] font-medium text-ink-3">{DAY_LABELS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]} · {dateLabel}</p>
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
                            {timeOf(s.startsAt.toISOString())} {s.batchName}
                          </span>
                          <span className="text-[12.5px] text-ink-3">
                            {s.marked} / {s.total}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-pill bg-deck overflow-hidden">
                          <div
                            className={`h-full rounded-pill ${
                              s.marked === 0 ? "bg-water" : s.marked / s.total < 0.5 ? "bg-warn" : "bg-good"
                            }`}
                            style={{ width: `${s.total > 0 ? Math.round((s.marked / s.total) * 100) : 0}%` }}
                          />
                        </div>
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