import Link from "next/link";
import { CalendarCheck, ChevronRight, Clock } from "lucide-react";
import {
  getTodayAction,
  getScheduleAction,
  getCoachRosterAction,
} from "@/lib/actions/coach";
import { todayInZone } from "@/lib/time/tz";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDay(iso: string): string {
  // e.g. "Mon 23 Sep"
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

// Phase 2.2 + 4.8 — coach home. Today's sessions up top (the
// one-register-at-a-time surface — what a coach actually uses
// standing at the poolside). Below: this week's schedule and
// the coach's roster. All reads go through coach-scope
// filtering at the service layer — a coach never sees another
// coach's sessions or roster.
//
// Composition per DESIGN.md: one dominant element (today's
// sessions, the only thing a coach touches during a session),
// with secondary reads underneath the fold.
export default async function CoachTodayPage() {
  const [{ sessions }, schedule, roster] = await Promise.all([
    getTodayAction(),
    getScheduleAction({ days: 7 }),
    getCoachRosterAction(),
  ]);

  const todayLocal = todayInZone("Asia/Kolkata");

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[22px] font-semibold text-marine">Today</h1>

      {sessions.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[15px] font-medium">No sessions today</p>
          <p className="mt-2 text-[13px] text-ink-3">
            Sessions are generated four weeks ahead for each batch.
          </p>
        </div>
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

      {/* 4.8 — this week's schedule */}
      <section className="mt-10">
        <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
          <Clock size={15} className="text-ink-3" />
          This week
        </h2>
        {schedule.days.every((d) => d.sessions.length === 0) ? (
          <p className="mt-2 text-[13px] text-ink-3">No sessions scheduled.</p>
        ) : (
          <ul className="mt-2 rounded-card border border-line bg-paper overflow-hidden">
            {schedule.days
              .filter((d) => d.sessions.length > 0)
              .map((d) => (
                <li key={d.date} className="px-4 py-3 border-b border-line last:border-b-0">
                  <p className="text-[12px] uppercase tracking-wide text-ink-3 font-medium">
                    {d.date === todayLocal ? "Today" : shortDay(d.date)}
                    <span className="ml-1.5 text-ink-2 normal-case font-normal">
                      {d.date}
                    </span>
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {d.sessions.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-baseline gap-2 text-[13px]"
                      >
                        <span className="font-mono tabular-nums text-ink-2">
{timeOf(s.startsAt instanceof Date ? s.startsAt.toISOString() : s.startsAt)}
                        </span>
                        <span className="truncate">{s.batchName}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* 4.8 — the coach's roster (members they coach, by batch) */}
      <section className="mt-10">
        <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
          <CalendarCheck size={15} className="text-ink-3" />
          Your roster
        </h2>
        {roster.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-3">
            No batches assigned to your login yet. Once an owner puts you on a batch, its roster lands here.
          </p>
        ) : (
          <ul className="mt-2 rounded-card border border-line bg-paper overflow-hidden">
            {roster.map((r) => (
              <li
                key={r.memberId}
                className="px-4 py-3 border-b border-line last:border-b-0 flex items-baseline gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium truncate">{r.name}</p>
                  <p className="text-[12px] text-ink-3 truncate">
                    {r.code} · {r.batches.join(", ") || "no batches"}
                  </p>
                </div>
                <ChevronRight size={16} className="text-ink-3 flex-none" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
