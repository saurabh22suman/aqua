"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { DateCalendarHeader } from "./DateCalendarHeader";
import { CalendarDayGrid } from "./calendar-day-grid";
import {
  calendarPopupLayout,
  clientViewport,
  type CalendarAnchor,
  type CalendarPopupLayout,
} from "./calendar-viewport";
import {
  addCalendarMonths,
  calendarWeekday,
  daysInCalendarMonth,
  EARLIEST_CALENDAR_YEAR,
  formatCalendarDate,
  isRealCalendarDate,
  parseCalendarDate,
  type CalendarDate,
} from "@/lib/time/calendar";

// The shared date field's MONTH CALENDAR.
//
// The date is a CHOICE, so the choice is drawn: a month grid in the
// product's own surfaces, opened from the shared DateField. There is no
// dependency and no native date control — the browser's own picker
// ignores the product's day-first format and renders US mm/dd/yyyy
// segments on this device locale.
//
// The month grid shows the month being viewed; the header moves a
// month at a time and names the month and the year directly, so a
// birth date is reachable without walking back month by month. The day
// buttons are real buttons (`type="button"`), so no calendar
// interaction can submit the form the field sits in. The arrow keys
// move the chosen day — and carry the DISPLAYED month with them when
// they cross a month or a year — Enter or Space picks it, and Escape
// closes the calendar. "Today" and "Clear" are the calendar's own
// actions.
//
// The popup is drawn in a portal and positioned against the viewport,
// so it is never clipped by an ancestor and never overflows a narrow
// screen. It is sized to the CLIENT viewport and follows it when it
// changes, and it never grows past the space the screen has: the rest
// of the month scrolls.

export type { CalendarAnchor as DateCalendarAnchor };

export type DateCalendarProps = {
  /** This calendar's own name: the field that owns it. */
  id: string;
  /** The chosen date (canonical `yyyy-mm-dd`), or "" when there is none. */
  value: string;
  /** Today in IST (canonical `yyyy-mm-dd`). */
  todayIso: string;
  /** The calendar's chosen day, as a canonical `yyyy-mm-dd`. */
  onSelect: (iso: string) => void;
  /** Clears the chosen date. Omitted when the field does not allow it. */
  onClear?: () => void;
  /** The calendar is dismissed (Escape). */
  onDismiss: () => void;
  /** Where the popup is anchored, in viewport coordinates. */
  anchor: CalendarAnchor;
  /** The popup element, so the field can tell whether it owns it. */
  popupRef?: RefObject<HTMLElement | null>;
  /** The accessible name of the calendar. */
  label?: string;
};

export function DateCalendar({
  id,
  value,
  todayIso,
  onSelect,
  onClear,
  onDismiss,
  anchor,
  popupRef,
  label = "Choose a date",
}: DateCalendarProps) {
  const selected = parseCalendarDate(value);
  const today = parseCalendarDate(todayIso);
  const [view, setView] = useState<CalendarDate>(
    () => selected ?? today ?? { year: EARLIEST_CALENDAR_YEAR, month: 1, day: 1 },
  );
  const [focusedIso, setFocusedIso] = useState<string>(() =>
    formatCalendarDate(selected ?? today ?? { year: 1970, month: 1, day: 1 }),
  );
  const [height, setHeight] = useState(0);
  const [layout, setLayout] = useState<CalendarPopupLayout>(() =>
    calendarPopupLayout(anchor, 0, clientViewport()),
  );
  const popupNode = useRef<HTMLDivElement | null>(null);
  const dayNodes = useRef(new Map<string, HTMLButtonElement>());
  const shouldMoveFocus = useRef(true);

  // The popup is as tall as the month it shows: a four, five or six
  // week month is a different height, so the popup is measured again
  // when the month changes and is placed against its real height.
  useLayoutEffect(() => {
    const popup = popupNode.current;
    if (!popup) return;
    const previousMaxHeight = popup.style.maxHeight;
    popup.style.maxHeight = "none";
    const naturalHeight = popup.offsetHeight;
    popup.style.maxHeight = previousMaxHeight;
    setHeight(naturalHeight);
  }, [view]);

  // The popup follows the viewport: it is measured and placed again
  // when the window is resized or the page is scrolled, so it never
  // sits where it can no longer be reached.
  useEffect(() => {
    function update() {
      setLayout(calendarPopupLayout(anchor, height, clientViewport()));
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, height]);

  // The chosen day keeps the keyboard focus while the calendar is open.
  useEffect(() => {
    if (!shouldMoveFocus.current) return;
    shouldMoveFocus.current = false;
    dayNodes.current.get(focusedIso)?.focus();
  }, [focusedIso]);

  function moveFocus(next: CalendarDate) {
    shouldMoveFocus.current = true;
    setFocusedIso(formatCalendarDate(next));
  }

  /** The day the keyboard is on, and the month the calendar shows. */
  function showDay(next: CalendarDate) {
    setView({ year: next.year, month: next.month, day: next.day });
    moveFocus(next);
  }

  /** The month on screen, and the day the keyboard is on inside it. */
  function showMonth(next: CalendarDate) {
    const day = Math.min(
      next.day,
      daysInCalendarMonth(next.year, next.month),
    );
    showDay({ year: next.year, month: next.month, day });
  }

  /**
   * The day arrows walk the calendar. They carry the DISPLAYED month
   * with them: a day arrow that crosses a month boundary shows the
   * month it landed in, and one that would leave the range the
   * calendar has does not move at all.
   */
  function shiftDay(days: number) {
    const current = parseCalendarDate(focusedIso) ?? view;
    const moved = new Date(
      Date.UTC(current.year, current.month - 1, current.day + days),
    );
    const next = {
      year: moved.getUTCFullYear(),
      month: moved.getUTCMonth() + 1,
      day: moved.getUTCDate(),
    };
    if (!isRealCalendarDate(next.year, next.month, next.day)) return;
    showDay(next);
  }

  /** Escape belongs to the popup, not to the day grid. */
  function handlePopupKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  }

  /** The day keys belong to the day grid alone. */
  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const shifts: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (event.key in shifts) {
      event.preventDefault();
      shiftDay(shifts[event.key]!);
      return;
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      showMonth(addCalendarMonths(view, -1));
      return;
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      showMonth(addCalendarMonths(view, 1));
      return;
    }
    const current = parseCalendarDate(focusedIso) ?? view;
    const weekday = (calendarWeekday(current) + 6) % 7;
    if (event.key === "Home") {
      event.preventDefault();
      shiftDay(-weekday);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      shiftDay(6 - weekday);
    }
  }

  const popup = (
    <div
      ref={(node) => {
        popupNode.current = node;
        if (popupRef) popupRef.current = node;
      }}
      role="dialog"
      aria-label={label}
      data-date-calendar={id}
      onKeyDown={handlePopupKeyDown}
      style={{
        top: layout.top,
        left: layout.left,
        width: layout.width,
        maxHeight: layout.maxHeight,
        overflowY: "auto",
      }}
      className="fixed z-50 rounded-card border border-line bg-paper p-3 shadow-lg"
    >
      <DateCalendarHeader view={view} onViewChange={showMonth} />

      <CalendarDayGrid
        view={view}
        focusedIso={focusedIso}
        todayIso={todayIso}
        value={value}
        onSelect={onSelect}
        onFocusDay={setFocusedIso}
        onKeyDown={handleGridKeyDown}
        registerDay={(iso, node) => {
          if (node) dayNodes.current.set(iso, node);
          else dayNodes.current.delete(iso);
        }}
      />

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <button
          type="button"
          onClick={() => onSelect(todayIso)}
          className="min-h-9 rounded-ctl px-3 text-[13px] font-medium text-ink-2"
        >
          Today
        </button>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="min-h-9 rounded-ctl px-3 text-[13px] font-medium text-ink-2"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(popup, document.body);
}
