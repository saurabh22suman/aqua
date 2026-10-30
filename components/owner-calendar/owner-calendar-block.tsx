import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.mjs";
import CalendarDays from "lucide-react/dist/esm/icons/calendar-days.mjs";
import CircleSlash from "lucide-react/dist/esm/icons/circle-slash.mjs";
import Ticket from "lucide-react/dist/esm/icons/ticket.mjs";

import { timeRange } from "./calendar-layout";
import {
  CATEGORY_TINT_CLASS,
  eventStatusLabel,
  isCancelled,
  type CalendarCategory,
  type CalendarEvent,
  type PlacedCalendarEvent,
} from "./calendar-model";

// The shared owner calendar — one event block.
//
// A block is as tall as its duration, so it can only carry what fits.
// The kind of event and the title always fit; the time needs a little
// more; the capacity line needs a full half hour. Whatever does not
// fit is still in the accessible name, in the agenda and in the detail
// panel — it is never simply lost.
//
// The clash marker sits in the corner, where the block's height cannot
// clip it.

const CATEGORY_ICON = {
  batch: CalendarDays,
  booking: Ticket,
} as const;

export function CalendarBlock({
  placed,
  categoryLabels,
  onSelect,
  interactive = true,
}: {
  placed: PlacedCalendarEvent;
  categoryLabels: Record<CalendarCategory, string>;
  onSelect: (event: CalendarEvent) => void;
  /** Short/narrow marks are descriptive only; their 44px companion row is the control. */
  interactive?: boolean;
}) {
  const { event, top, height, column, columns, clash } = placed;
  const Icon = CATEGORY_ICON[event.category];
  const width = 100 / columns;
  const cancelled = isCancelled(event.status);
  const meta = [event.capacityLabel, event.resourceLabel]
    .filter(Boolean)
    .join(" · ");
  // A block is as tall as its duration, so it can only carry what
  // fits. The title and the kind-of-event icon always fit; the time
  // needs a little more; the capacity line needs a full half hour.
  // Whatever does not fit is still in the accessible name, in the
  // agenda and in the detail panel — it is never simply lost.
  const showMeta = height >= 42;
  const showTime = height >= 30;

  const label = `${event.title}, ${timeRange(event.startMinutes, event.durationMinutes)}, ${categoryLabels[event.category]}${clash ? ", resource clash" : ""}`;
  const className = `absolute overflow-hidden rounded-md border border-line border-l-[3px] px-1.5 pt-0.5 text-left motion-fast transition-colors ${CATEGORY_TINT_CLASS[event.category]} ${
    cancelled ? "opacity-70" : ""
  } ${interactive ? "hover:brightness-[0.98]" : ""}`;
  const style = {
    top,
    height,
    left: `calc(${column * width}% + 2px)`,
    width: `calc(${width}% - 4px)`,
    borderLeftStyle: cancelled ? "dashed" : "solid",
  } as const;

  const content = (
    <>
      {/* The kind of event comes FIRST, so it is never the line the
          block's height cuts off. The clash marker sits in the corner,
          where it cannot be clipped either. */}
      <span className="flex items-center gap-1">
        <Icon
          size={11}
          strokeWidth={2}
          aria-hidden="true"
          className="flex-none text-ink-3"
        />
        <span className="block truncate text-[11px] font-medium leading-[13px] text-ink">
          {event.title}
        </span>
      </span>
      {showTime ? (
        <span className="block truncate text-[10px] leading-[12px] text-ink-2">
          {timeRange(event.startMinutes, event.durationMinutes)}
          <span className="text-ink-3"> · {categoryLabels[event.category]}</span>
        </span>
      ) : null}
      {showMeta && meta ? (
        <span className="block truncate text-[10px] leading-[12px] text-ink-3">
          {meta}
        </span>
      ) : null}
      {cancelled ? (
        <span className="flex items-center gap-1 text-[10px] leading-tight text-ink-3">
          <CircleSlash size={10} strokeWidth={2} aria-hidden="true" />
          {eventStatusLabel(event.status)}
        </span>
      ) : null}
      {clash ? (
        <span
          className="absolute right-0.5 top-0.5 flex items-center gap-1 rounded-[4px] bg-paper/90 px-1 text-[9.5px] font-medium leading-tight text-ink-2"
          data-testid="calendar-clash"
          title="Resource clash"
        >
          <AlertTriangle size={10} strokeWidth={2.2} aria-hidden="true" />
          Clash
        </span>
      ) : null}
      {event.capacityFillClass ? (
        <span
          className="absolute inset-x-0 bottom-0 block h-[3px] bg-deck"
          aria-hidden="true"
        >
          <span
            className={`block h-full ${event.capacityFillClass}`}
            style={{ width: `${event.capacityPercent ?? 0}%` }}
          />
        </span>
      ) : null}
    </>
  );

  if (!interactive) {
    return (
      <div
        role="img"
        aria-label={label}
        data-testid="calendar-event"
        data-event-id={event.id}
        data-category={event.category}
        data-top={top}
        data-height={height}
        data-column={column}
        data-columns={columns}
        data-interactive="false"
        className={className}
        style={style}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      data-testid="calendar-event"
      data-event-id={event.id}
      data-category={event.category}
      data-top={top}
      data-height={height}
      data-column={column}
      data-columns={columns}
      data-interactive="true"
      aria-label={label}
      className={className}
      style={style}
    >
      {content}
    </button>
  );
}
