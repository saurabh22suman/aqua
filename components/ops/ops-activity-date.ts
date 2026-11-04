// The activity filter's DATE model.
//
// The filter asks for DAYS, not for instants. An operator investigating
// a problem wants "what happened on the 28th", not a second of it, so
// the filter carries two calendar dates and the query carries
// `yyyy-mm-dd`.
//
// The reader turns a date-only bound into the IST calendar day it
// names (>= the day's midnight, < the next midnight). The ranges are
// calendar ranges too: "Last 7 days" is today and the six IST dates
// before it, never a rolling 24 hours.
//
// Pure on purpose: an instant in, a query out, and the arithmetic a
// test can read. No time model and no dependency.

import {
  istCalendarDate,
  parseCalendarDate,
  parseCalendarInstant,
  shiftCalendarDate,
  todayCalendarDate,
} from "@/lib/time/calendar";

/** The shape of a calendar date, before it is checked against the calendar. */
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** The range choices the filter offers. */
export const DATE_RANGE_OPTIONS = [
  { value: "", label: "Any date" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
] as const;

export type ActivityDateFilterState = {
  action: string;
  tenantId: string;
  range: string;
  sinceDate: string;
  untilDate: string;
};

export type ActivityQueryResult =
  | { ok: true; query: string }
  | { ok: false; error: string };

/** The calendar days a relative range covers, in IST. */
export function activityDateRangeBounds(
  range: string,
  now: Date = new Date(),
): { since: string; until: string } | null {
  const today = todayCalendarDate(now);
  if (range === "today") return { since: today, until: today };
  if (range === "7d") {
    return { since: shiftCalendarDate(today, -6), until: today };
  }
  if (range === "30d") {
    return { since: shiftCalendarDate(today, -29), until: today };
  }
  return null;
}

/**
 * The calendar date an inbound bound names.
 *
 * A calendar date is kept as it is — even an impossible one, which the
 * field then refuses. A legacy timestamp is normalised to the IST date
 * it falls on, so an old link and the controls beside it name the same
 * day. The timestamp is parsed STRICTLY: an instant whose own date does
 * not exist (30 February) is refused, never rolled into the next month
 * by the parser JavaScript ships with. Anything else is refused: a
 * filter that cannot be read is never quietly dropped.
 */
export function normalizeActivityDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (DATE_SHAPE.test(trimmed)) {
    return parseCalendarDate(trimmed) ? trimmed : null;
  }
  const instant = parseCalendarInstant(trimmed);
  if (!instant) return null;
  const day = istCalendarDate(instant);
  // The day must be one the product's calendar has.
  return parseCalendarDate(day) ? day : null;
}

/** The query the filter submits. */
export function buildActivityDateQuery(
  state: ActivityDateFilterState,
  now: Date = new Date(),
): ActivityQueryResult {
  const params = new URLSearchParams();
  if (state.action.trim()) params.set("action", state.action.trim());
  if (state.tenantId.trim()) params.set("tenantId", state.tenantId.trim());

  let since = "";
  let until = "";

  if (state.range === "custom") {
    since = state.sinceDate.trim();
    until = state.untilDate.trim();
    if (since && !parseCalendarDate(since)) {
      return { ok: false, error: "Enter a real start date." };
    }
    if (until && !parseCalendarDate(until)) {
      return { ok: false, error: "Enter a real end date." };
    }
    if (since && until && since > until) {
      return { ok: false, error: "The start must not be after the end." };
    }
  } else {
    const bounds = activityDateRangeBounds(state.range, now);
    if (bounds) {
      since = bounds.since;
      until = bounds.until;
    }
  }

  if (since) params.set("since", since);
  if (until) params.set("until", until);
  return { ok: true, query: params.toString() };
}
