"use client";

import { Select } from "./Select";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import {
  addCalendarMonths,
  addCalendarYears,
  CALENDAR_MONTH_NAMES,
  EARLIEST_CALENDAR_YEAR,
  LATEST_CALENDAR_YEAR,
  type CalendarDate,
} from "@/lib/time/calendar";

// The calendar's HEADER: the month, the year, and the two buttons that
// move a month at a time.
//
// The month and the year are NAMED, not walked to: a birth date is
// reachable by choosing the year and the month, not by pressing
// "previous month" a few hundred times. The year list runs from the
// earliest year the product accepts to sixty years beyond the year on
// screen — and never past the last four-digit year, because a calendar
// date is four digits and a day outside that range is not a date the
// product can store.
//
// THE LAYOUT. The popup is at most 320px wide, so the month and the
// year and the two arrows cannot share one row without squeezing the
// month name until it does not fit. The header therefore REFLOWS: the
// selectors take a row of their own and the arrows frame the grid
// below them. The arrows are 44px targets — they are how a person
// moves the month, and a small target is a missed month.
//
// The dropdowns are the product's own shared select, which draws its
// popup: the browser's dropdown is never allowed to open. The shared
// control keeps its own type and padding: the calendar does not shrink
// the product's control to make room for itself.

export type DateCalendarHeaderProps = {
  view: CalendarDate;
  maxIsoDate?: string;
  onViewChange: (next: CalendarDate) => void;
};

export function DateCalendarHeader({
  view,
  maxIsoDate,
  onViewChange,
}: DateCalendarHeaderProps) {
  const maxYear = maxIsoDate ? Number(maxIsoDate.slice(0, 4)) : LATEST_CALENDAR_YEAR;
  const lastYear = Math.min(view.year + 60, LATEST_CALENDAR_YEAR, maxYear);
  const years = Array.from(
    { length: lastYear - EARLIEST_CALENDAR_YEAR + 1 },
    (_, index) => EARLIEST_CALENDAR_YEAR + index,
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="flex min-w-0 flex-1 gap-1.5">
        {/* THE MONTH GETS MORE OF THE ROW THAN THE YEAR. The month is
            named in full ("September", "November") and the year is four
            digits, so a row split evenly leaves the month too narrow to
            read at 320 with a classic scrollbar. The split is 3:2 —
            the same shared select, the same 16px type and the same
            padding in both. */}
        <div className="min-w-0 flex-[3]">
          <Select
            aria-label="Month"
            value={String(view.month)}
            onChange={(event) =>
              onViewChange(
                addCalendarMonths(
                  { year: view.year, month: view.month, day: 1 },
                  Number(event.target.value) - view.month,
                ),
              )
            }
            className="w-full"
          >
            {CALENDAR_MONTH_NAMES.map((name, index) => (
              <option key={name} value={String(index + 1)}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-0 flex-[2]">
          <Select
            aria-label="Year"
            value={String(view.year)}
            onChange={(event) =>
              onViewChange(
                addCalendarYears(
                  { year: view.year, month: view.month, day: 1 },
                  Number(event.target.value) - view.year,
                ),
              )
            }
            className="w-full"
          >
            {years.map((year) => (
              <option key={year} value={String(year)}>
                {year}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-1.5">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onViewChange(addCalendarMonths(view, -1))}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-[var(--control-border)] text-ink-2"
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onViewChange(addCalendarMonths(view, 1))}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-[var(--control-border)] text-ink-2"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
