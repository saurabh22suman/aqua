// The shared owner calendar — the event detail panel.
//
// Opening an event shows what the block could not carry: the date and
// time, the identity of the thing itself, who or what it belongs to,
// and its state. The panel is a real dialog (the shared primitive), so
// it traps focus, closes on Escape and returns focus to the block that
// opened it.
//
// The rows are supplied by the owning surface, so the panel stays a
// presentation concern and never guesses at domain meaning.

import { timeRange } from "./calendar-layout";
import {
  CATEGORY_TINT_CLASS,
  eventStatusLabel,
  type CalendarCategory,
  type CalendarEvent,
} from "./calendar-model";
import { formatFullDateIST } from "@/lib/time/tz";

export function CalendarEventDetail({
  event,
  categoryLabels,
  actions,
}: {
  event: CalendarEvent;
  categoryLabels: Record<CalendarCategory, string>;
  actions?: React.ReactNode;
}) {
  return (
    <div data-testid="calendar-detail">
      <p
        className={`inline-flex items-center gap-1.5 rounded-pill border border-line px-3 py-1 text-[11px] font-medium text-ink-2 ${CATEGORY_TINT_CLASS[event.category]}`}
      >
        {categoryLabels[event.category]}
      </p>
      <p className="mt-3 font-display text-[16px] font-semibold text-ink">
        {event.title}
      </p>
      <p className="mt-1 text-[13px] text-ink-2">
        {formatFullDateIST(event.startsAt)}
        {" · "}
        {timeRange(event.startMinutes, event.durationMinutes)}
      </p>

      <dl className="mt-4 divide-y divide-line border-t border-line">
        {event.detail.map((row) => (
          <div
            key={`${row.label}-${row.value}`}
            className="flex items-start justify-between gap-3 py-2.5"
          >
            <dt className="text-[12px] text-ink-3">{row.label}</dt>
            <dd className="text-right text-[13px] text-ink">{row.value}</dd>
          </div>
        ))}
        <div className="flex items-start justify-between gap-3 py-2.5">
          <dt className="text-[12px] text-ink-3">Status</dt>
          <dd className="text-right text-[13px] text-ink">
            {eventStatusLabel(event.status)}
          </dd>
        </div>
      </dl>

      {actions ? <div className="mt-4">{actions}</div> : null}
    </div>
  );
}
