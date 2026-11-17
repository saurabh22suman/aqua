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

import { OwnerIcon } from "@/components/owner-ui/owner-icon";

import { timeRange } from "./calendar-layout";
import type { DayProjection } from "./calendar-projection";
import {
  CATEGORY_ICON_NAME,
  CATEGORY_TINT_CLASS,
  eventStatusLabel,
  isCancelled,
  type CalendarCategory,
  type CalendarEvent,
} from "./calendar-model";

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
        const cancelled = isCancelled(event.status);
        const continuation = Boolean(day && event.date !== day);
        const meta = [
          continuation ? "Continued from previous day" : null,
          event.capacityLabel,
          event.resourceLabel,
        ]
          .filter(Boolean)
          .join(" · ");
        const range = timeRange(
          useProjectionTime ? projection.startMinutes : event.startMinutes,
          useProjectionTime ? projection.durationMinutes : event.durationMinutes,
        );
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
                {range.split(/(\d{1,2}:\d{2} [ap]m)/g).map((part, index) =>
                  index % 2 ? <span className="whitespace-nowrap" key={index}>{part}</span> : part,
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[14px] font-medium text-ink">
                  {event.title}
                </span>
                <span className="mt-0.5 flex items-start gap-1 text-[11.5px] text-ink-3">
                  <OwnerIcon
                    name={CATEGORY_ICON_NAME[event.category]}
                    size={12}
                    className="mt-[2px] flex-none"
                  />
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
