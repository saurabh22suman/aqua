import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getTodayAction } from "@/lib/actions/coach";
import { requireReception } from "@/lib/auth/surface-guard";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatTimeIST } from "@/lib/time/tz";

export default async function ReceptionTodayPage() {
  await requireReception();
  const { sessions } = await getTodayAction();

  return (
    <main className="px-5 pt-10">
      <h1 className="font-display text-[22px] font-semibold text-marine">Today</h1>

      <Link
        href="/reception/collect-payment"
        className="mt-6 flex items-center gap-3 bg-paper border border-line rounded-card px-4 min-h-[56px] py-3"
        data-testid="collect-payment-link"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Collect payment</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Show a club payment QR with the amount.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>

      <Link
        href="/reception/cafe"
        className="mt-3 flex items-center gap-3 bg-paper border border-line rounded-card px-4 min-h-[56px] py-3"
        data-testid="cafe-link"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Café</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Take a counter order and settle it.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>

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
                      {formatTimeIST(s.startsAt)} {s.batchName}
                    </span>
                    <span className="text-[13px] text-ink-3">
                      {s.total === 0 ? "No one enrolled" : `${s.marked} / ${s.total}`}
                    </span>
                  </div>
                  {s.total > 0 ? (
                    <div className="h-1.5 rounded-pill bg-deck overflow-hidden">
                      <div
                        className={`h-full rounded-pill ${fill}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : null}
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