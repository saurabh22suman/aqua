import Link from "next/link";
import { getTodayAction } from "@/lib/actions/coach";

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export default async function CoachTodayPage() {
  const { sessions } = await getTodayAction();

  return (
    <main className="px-5 pt-10">
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
    </main>
  );
}
