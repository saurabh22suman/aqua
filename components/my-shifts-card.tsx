import { CalendarDays } from "lucide-react";
import {
  formatTimeIST,
  formatWeekdayDateIST,
} from "@/lib/time/tz";
import type { MyShiftRow } from "@/lib/services/shifts";

// V-23 — the staff member's own published roster, on the Me tab. The
// page reads through listMyShiftsAction (staff.self) and passes the
// rows in; the service returns only the caller's own published shifts,
// so this card can never surface a colleague's draft. A pure
// component, so page tests can render it without a data layer.

export function MyShiftsCard({ shifts }: { shifts: MyShiftRow[] }) {
  return (
    <section className="mt-5 rounded-card border border-line bg-paper p-4">
      <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
        <CalendarDays size={15} className="text-ink-3" />
        My shifts
      </h2>
      {shifts.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No published shifts in the next two weeks.
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {shifts.map((shift) => (
            <li
              key={shift.id}
              className="flex items-baseline justify-between gap-3 py-2.5"
            >
              <span className="text-[13.5px]">
                {formatWeekdayDateIST(`${shift.shiftDate}T12:00:00Z`)}
              </span>
              <span className="text-[13px] text-ink-3 tabular-nums">
                {formatTimeIST(shift.startAt)} – {formatTimeIST(shift.endAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
