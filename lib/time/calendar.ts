// The product's CALENDAR arithmetic.
//
// A calendar date (`yyyy-mm-dd`) is a DAY, not an instant. Everything
// that turns one into a comparison needs the same answer: the day starts
// at 00:00 IST and ends at the next 00:00 IST. Asia/Kolkata has no
// daylight saving, so the offset is a fixed +05:30 and a day is always
// 24 hours long.
//
// THE PARSER IS STRICT. JavaScript's own Date rolls an impossible day
// over — `new Date("2026-02-30")` is 2 March, not an invalid date — so a
// permissive parse would silently read a DIFFERENT day from the one the
// operator asked for. A calendar date here is either a real day or it is
// nothing at all.
//
// This module is pure: no React, no database, no clock beyond an
// injected `now`. The shared DateField's calendar, the Ops date filters
// and the platform activity reader all use these same helpers, so the
// three can never disagree about what a date means.

import { addDays, dayRangeUtc, todayInZone } from "./tz";

/** The zone the product's calendar days are counted in. */
export const IST_TIME_ZONE = "Asia/Kolkata";

export type CalendarDate = {
  year: number;
  /** 1-based: 1 is January. */
  month: number;
  day: number;
};

/** The strict shape of a calendar date. */
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The first year the shared parser accepts (the existing rule). */
export const EARLIEST_CALENDAR_YEAR = 1900;

/**
 * The last year the shared parser accepts.
 *
 * A calendar date is four digits (`yyyy-mm-dd`), so a year is too. The
 * calendar's year list grows with the year on screen, and an unbounded
 * list walks out of the four-digit range and offers a day the product
 * cannot store.
 */
export const LATEST_CALENDAR_YEAR = 9999;

/** An explicit instant: an ISO timestamp with its offset named. */
const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** The number of days in a month, leap years included. */
export function daysInCalendarMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether the parts name a day that really exists. */
export function isRealCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < EARLIEST_CALENDAR_YEAR) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInCalendarMonth(year, month)) return false;
  return true;
}

/** The parts of a calendar date, or null when the value is not one. */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealCalendarDate(year, month, day)) return null;
  return { year, month, day };
}

/** The canonical `yyyy-mm-dd` form of a calendar date. */
export function formatCalendarDate(date: CalendarDate): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/** The same date, shifted by whole months (the day clamps to the month). */
export function addCalendarMonths(
  date: CalendarDate,
  delta: number,
): CalendarDate {
  // The shift is clamped to the range the product's calendar has, so
  // the arrows cannot walk into a year the calendar does not have.
  const first = EARLIEST_CALENDAR_YEAR * 12;
  const last = LATEST_CALENDAR_YEAR * 12 + 11;
  const total = Math.min(
    last,
    Math.max(first, date.year * 12 + (date.month - 1) + delta),
  );
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return {
    year,
    month,
    day: Math.min(date.day, daysInCalendarMonth(year, month)),
  };
}

/** The same date, shifted by whole years (29 February becomes 28 February). */
export function addCalendarYears(date: CalendarDate, delta: number): CalendarDate {
  const year = Math.min(
    LATEST_CALENDAR_YEAR,
    Math.max(EARLIEST_CALENDAR_YEAR, date.year + delta),
  );
  return {
    year,
    month: date.month,
    day: Math.min(date.day, daysInCalendarMonth(year, date.month)),
  };
}

/**
 * An explicit instant, or null when it is not one.
 *
 * The parser JavaScript ships with ROLLS an impossible day over:
 * `new Date("2026-02-30T12:00:00+05:30")` is 2 March, not an invalid
 * date, so a permissive read would name a DIFFERENT day from the one
 * the timestamp carries. The calendar parts are therefore checked
 * against the calendar before the instant is built.
 */
export function parseCalendarInstant(value: string): Date | null {
  const match = INSTANT_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInCalendarMonth(year, month)) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** The weekday of a calendar date, 0 is Sunday. */
export function calendarWeekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Today in IST, as a calendar date. */
export function todayCalendarDate(now: Date = new Date()): string {
  return todayInZone(IST_TIME_ZONE, now.getTime());
}

/**
 * The instants a calendar day covers: its 00:00 IST start and the next
 * day's 00:00 IST start (the EXCLUSIVE end).
 */
export function istDayBounds(dateIso: string): {
  fromUtc: Date;
  toUtc: Date;
} {
  return dayRangeUtc(dateIso, IST_TIME_ZONE);
}

/** The day a calendar date falls on, for an instant. */
export function istCalendarDate(instant: Date): string {
  return todayInZone(IST_TIME_ZONE, instant.getTime());
}

/** The calendar date `days` days after the given one. */
export function shiftCalendarDate(dateIso: string, days: number): string {
  return addDays(dateIso, days);
}

/** The calendar dates of the last `count` days, ending today (IST). */
export function recentCalendarDates(
  count: number,
  now: Date = new Date(),
): string[] {
  const today = todayCalendarDate(now);
  return Array.from({ length: count }, (_, index) =>
    addDays(today, -(count - 1 - index)),
  );
}

// THE DISPLAY AND THE PARSER.
//
// The field shows DD/MM/YYYY and the product stores yyyy-mm-dd. These
// two helpers are the shared contract between them: they are exported
// from components/ui/DateField.tsx as well, because their behaviour
// (a leap day is accepted, an impossible day is not) is part of that
// component's public surface.

/** The day-first display of a canonical date. */
export function isoToDisplay(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** The canonical date of a day-first display, or null when it is not one. */
export function displayToIso(display: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < EARLIEST_CALENDAR_YEAR || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The progressive dd/mm/yyyy mask: digits only, slashes inserted after
 * the day and the month, capped at eight digits.
 */
export function maskDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i === 2 || i === 4) out += "/";
    out += digits[i];
  }
  return out;
}

/** The month names the calendar and the filters use. */
export const CALENDAR_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The week starts on Monday, as the product's locale does. */
export const CALENDAR_WEEKDAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * The month grid: whole weeks, with the days outside the month left
 * blank. A blank cell is never a day that can be chosen, so the grid
 * cannot offer a date from a month the operator is not looking at.
 */
export function buildCalendarWeeks(
  year: number,
  month: number,
): (CalendarDate | null)[][] {
  const total = daysInCalendarMonth(year, month);
  const leading = (calendarWeekday({ year, month, day: 1 }) + 6) % 7;
  const weeks: (CalendarDate | null)[][] = [];
  let day = 1 - leading;
  while (day <= total) {
    const week: (CalendarDate | null)[] = [];
    for (let index = 0; index < 7; index += 1) {
      week.push(
        day >= 1 && day <= total ? { year, month, day } : null,
      );
      day += 1;
    }
    weeks.push(week);
  }
  return weeks;
}
