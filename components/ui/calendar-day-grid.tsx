"use client";

import type { KeyboardEvent } from "react";
import {
  CALENDAR_MONTH_NAMES,
  CALENDAR_WEEKDAY_NAMES,
  formatCalendarDate,
  type CalendarDate,
} from "@/lib/time/calendar";

// The calendar's MONTH GRID.
//
// The grid is the calendar's own keyboard surface: the day keys belong
// to it and to nothing else. The header's controls are ABOVE the grid,
// so their own arrow, page and home keys are never taken by a day
// movement.
//
// The chosen day keeps the keyboard focus (the roving tabindex): one
// day in the month is reachable with Tab, and the arrows walk the rest.

export type CalendarDayGridProps = {
  view: CalendarDate;
  /** The day the keyboard is on, as a canonical `yyyy-mm-dd`. */
  focusedIso: string;
  /** Today in IST, as a canonical `yyyy-mm-dd`. */
  todayIso: string;
  /** The chosen date, as a canonical `yyyy-mm-dd`. */
  value: string;
  maxIsoDate?: string;
  onSelect: (iso: string) => void;
  onFocusDay: (iso: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** Registers a day button, so the calendar can move the focus to it. */
  registerDay: (iso: string, node: HTMLButtonElement | null) => void;
};

export function CalendarDayGrid({
  view,
  focusedIso,
  todayIso,
  value,
  maxIsoDate,
  onSelect,
  onFocusDay,
  onKeyDown,
  registerDay,
}: CalendarDayGridProps) {
  const weeks = buildWeeks(view);

  return (
    <div
      role="grid"
      aria-label={`${CALENDAR_MONTH_NAMES[view.month - 1]} ${view.year}`}
      className="mt-2"
      onKeyDown={onKeyDown}
    >
      <div role="row" className="grid grid-cols-7 gap-0.5">
        {CALENDAR_WEEKDAY_NAMES.map((weekday) => (
          <span
            key={weekday}
            role="columnheader"
            className="py-1 text-center text-[11px] font-medium text-ink-3"
          >
            {weekday}
          </span>
        ))}
      </div>
      {weeks.map((week, weekIndex) => (
        <div role="row" key={weekIndex} className="grid grid-cols-7 gap-0.5">
          {week.map((day, dayIndex) => {
            if (!day) {
              return <span key={dayIndex} role="gridcell" aria-hidden="true" />;
            }
            const iso = formatCalendarDate(day);
            const isSelected = iso === value;
            const isToday = iso === todayIso;
            return (
              <span key={iso} role="gridcell" aria-selected={isSelected}>
                <button
                  type="button"
                  ref={(node) => registerDay(iso, node)}
                  tabIndex={iso === focusedIso ? 0 : -1}
                  aria-label={`${day.day} ${CALENDAR_MONTH_NAMES[day.month - 1]} ${day.year}`}
                  aria-current={isToday ? "date" : undefined}
                  disabled={Boolean(maxIsoDate && iso > maxIsoDate)}
                  onClick={() => onSelect(iso)}
                  onFocus={() => onFocusDay(iso)}
                  className={`flex h-9 w-full min-w-0 items-center justify-center rounded-ctl text-[13px] ${
                    isSelected
                      ? "bg-[var(--accent-strong)] font-semibold text-paper"
                      : isToday
                        ? "border border-[var(--accent-strong)] text-ink"
                        : "text-ink-2"
                  }`}
                >
                  {day.day}
                </button>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * The month grid: whole weeks, with the days outside the month left
 * blank. A blank cell is never a day that can be chosen, so the grid
 * cannot offer a date from a month the operator is not looking at.
 */
function buildWeeks(view: CalendarDate): (CalendarDate | null)[][] {
  const weeks: (CalendarDate | null)[][] = [];
  const total = daysInMonth(view);
  const leading = (weekdayOf(view) + 6) % 7;
  let day = 1 - leading;
  while (day <= total) {
    const week: (CalendarDate | null)[] = [];
    for (let index = 0; index < 7; index += 1) {
      week.push(
        day >= 1 && day <= total ? { year: view.year, month: view.month, day } : null,
      );
      day += 1;
    }
    weeks.push(week);
  }
  return weeks;
}

function daysInMonth(view: CalendarDate): number {
  return new Date(Date.UTC(view.year, view.month, 0)).getUTCDate();
}

function weekdayOf(view: CalendarDate): number {
  return new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay();
}
