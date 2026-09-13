import { AlertTriangle } from "lucide-react";
import type { MemberAlertRow } from "@/lib/services/absence-alerts";

// R.8 — read-only absence alerts for the coach member detail page.
// The parent page carries the same fact as one line (parentAlertLine).
export function AbsenceAlertsList({ alerts }: { alerts: MemberAlertRow[] }) {
  if (alerts.length === 0) return null;

  return (
    <section className="mt-4">
      <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
        <AlertTriangle size={15} className="text-ink-3" />
        Attendance alerts
      </h2>
      <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
        {alerts.map((a) => (
          <li key={a.alertId} className="px-3.5 py-2.5 text-[13px]">
            <p className="font-medium">{alertTitle(a)}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-3">
              {a.batchName} · week {a.calendarWeek}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function alertTitle(alert: MemberAlertRow): string {
  if (alert.alertKind === "consecutive_absences") {
    const streak = Number(alert.detail?.streak ?? 3);
    return `${streak} sessions missed in a row`;
  }
  const pct = alert.detail?.pct;
  return pct !== undefined
    ? `Attendance below the alert level (${pct}% this month)`
    : "Attendance below the alert level this month";
}
