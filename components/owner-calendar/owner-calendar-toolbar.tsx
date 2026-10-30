// The shared owner calendar — the toolbar.
//
// The row above the calendar: the date controls on the left, whatever
// the surface adds on the right (the schedule adds its day/week/month
// switch, the shared segmented tabs), and the range the calendar is
// showing with the zone it is showing it in.
//
// The controls are the shared Button primitive. The view switch is
// injected by the calling surface so the calendar never grows a
// second navigation system of its own.

import { CalendarNavControl } from "./owner-calendar-nav";
import type { CalendarNavTarget } from "./owner-calendar-types";

export type OwnerCalendarToolbarProps = {
  navigation: {
    previous?: CalendarNavTarget;
    today?: CalendarNavTarget;
    next?: CalendarNavTarget;
  };
  /** The human range, e.g. "Mon 26 Oct – Sun 1 Nov 2026". */
  rangeLabel: string;
  /** The display zone, shown beside the range. */
  timezone: string;
  /**
   * Owner OpenPen (29 October 2026) — navigation names the period it
   * moves ("Previous week"), not just "Previous". Defaults keep the
   * shorter wording for callers that do not know their period.
   */
  labels?: {
    previous?: React.ReactNode;
    today?: React.ReactNode;
    next?: React.ReactNode;
  };
  /** Full accessible names when the visible label is deliberately short. */
  ariaLabels?: {
    previous?: string;
    today?: string;
    next?: string;
  };
  /** The surface's own controls for this row. */
  toolbarExtra?: React.ReactNode;
};

export function OwnerCalendarToolbar({
  navigation,
  rangeLabel,
  timezone,
  labels,
  ariaLabels,
  toolbarExtra,
}: OwnerCalendarToolbarProps) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {navigation.previous ? (
          <CalendarNavControl
            target={navigation.previous}
            testId="calendar-previous"
            className="gap-1"
            ariaLabel={ariaLabels?.previous}
          >
            {labels?.previous ?? "Previous"}
          </CalendarNavControl>
        ) : null}
        {navigation.today ? (
          <CalendarNavControl
            target={navigation.today}
            testId="calendar-today"
            ariaLabel={ariaLabels?.today}
          >
            {labels?.today ?? "Today"}
          </CalendarNavControl>
        ) : null}
        {navigation.next ? (
          <CalendarNavControl
            target={navigation.next}
            testId="calendar-next"
            className="gap-1"
            ariaLabel={ariaLabels?.next}
          >
            {labels?.next ?? "Next"}
          </CalendarNavControl>
        ) : null}
        {toolbarExtra ? <div className="ml-auto">{toolbarExtra}</div> : null}
      </div>

      <p className="mt-3 text-[12.5px] text-ink-3" data-testid="calendar-range">
        {rangeLabel} · {timezone}
      </p>
    </div>
  );
}
