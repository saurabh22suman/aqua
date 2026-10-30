// The shared owner calendar — the phone agenda.
//
// A seven-column time grid is unreadable at 390px and would need
// sideways scrolling, which this product does not do. On a phone the
// same events are listed for the selected day: every event keeps its
// time range, its identity and its state, in reading order.
//
// The agenda is not a second, smaller grid — it is the same events
// with the information a list can carry, so nothing is hidden by the
// change of shape.

import CalendarDays from "lucide-react/dist/esm/icons/calendar-days.mjs";
import Ticket from "lucide-react/dist/esm/icons/ticket.mjs";

import { timeRange } from "./calendar-layout";
import type { DayProjection } from "./calendar-projection";
import {
  CATEGORY_TINT_CLASS,
  eventStatusLabel,
  isCancelled,
  type CalendarCategory,
  type CalendarEvent,
} from "./calendar-model";

const CATEGORY_ICON = {
  batch: CalendarDays,
  booking: Ticket,
} as const;

export function OwnerCalendarAgenda({
  projections,
  categoryLabels,
  onSelectEvent,
  day,
  useProjectionTime = false,
}: {
  /** The day's events, already ordered by the part of the day they
   * fall in — a session still running from last night comes first. */
  projections: DayProjection[];
  categoryLabels: Record<CalendarCategory, string>;
  onSelectEvent: (event: CalendarEvent) => void;
  /** When supplied, a continuation from the previous day is stated. */
  day?: string;
  /** Show the part of the event that falls on this day (companion list). */
  useProjectionTime?: boolean;
}) {
  return (
    <ul className="divide-y divide-line" data-testid="calendar-agenda">
      {projections.map((projection) => {
        const { event } = projection;
        const Icon = CATEGORY_ICON[event.category];
        const cancelled = isCancelled(event.status);
        const continuation = Boolean(day && event.date !== day);
        const meta = [
          continuation ? "Continued from previous day" : null,
          event.capacityLabel,
          event.resourceLabel,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={event.id}>
            <button
              type="button"
              onClick={() => onSelectEvent(event)}
              data-testid="calendar-agenda-item"
              data-event-id={event.id}
              className={`flex min-h-11 w-full items-start gap-3 border-l-[3px] py-3 pl-3 pr-1 text-left motion-fast transition-colors hover:brightness-[0.98] ${CATEGORY_TINT_CLASS[event.category]} ${
                cancelled ? "opacity-70" : ""
              }`}
            >
              <span className="w-[92px] flex-none text-[12px] tabular-nums text-ink-2">
                {timeRange(
                  useProjectionTime ? projection.startMinutes : event.startMinutes,
                  useProjectionTime ? projection.durationMinutes : event.durationMinutes,
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[14px] font-medium text-ink">
                  {event.title}
                </span>
                <span className="mt-0.5 flex items-start gap-1 text-[11.5px] text-ink-3">
                  <Icon size={12} strokeWidth={2} aria-hidden="true" className="mt-[2px] flex-none" />
                  {categoryLabels[event.category]}
                  {cancelled ? ` · ${eventStatusLabel(event.status)}` : ""}
                </span>
                {meta ? (
                  <span className="mt-0.5 block break-words text-[12px] text-ink-3">
                    {meta}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
