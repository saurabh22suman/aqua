import { getTodayAction } from "@/lib/actions/coach";
import { requireReception } from "@/lib/auth/surface-guard";
import { EmptyState } from "@/components/ui/EmptyState";

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export default async function ReceptionTodayPage() {
  await requireReception();
  const { sessions } = await getTodayAction();

  return (
    <main className="px-5 pt-10">
      <h1 className="font-display text-[22px] font-semibold text-marine">Today</h1>

      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions today"
          body="Sessions are generated four weeks ahead for each batch."
        />
      ) : (
        <ul className="mt-6 space-y-4">
          {sessions.map((s) => {
            const pct = s.total > 0 ? Math.round((s.marked / s.total) * 100) : 0;
            const fill = s.marked === 0 ? "bg-water" : pct < 50 ? "bg-warn" : "bg-good";
            return (
              <li key={s.id}>
                <div className="bg-paper rounded-card border border-line p-4">
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
                  <p className="mt-2.5 text-[12px] text-ink-3">
                    Coach will mark attendance.
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}