import { ownerFacilityHref } from "@/lib/owner-scope/facility";

// Audit simplification (21 November 2026) — one Schedule job, two
// surfaces. The calendar (`/owner/schedule`) and the exception list
// (`/owner/sessions`) keep their shipped URLs and permission guards;
// this module is the single place that knows which surface a
// permission profile may open and how the two carry the owner's chosen
// club, day and calendar view between them.
//
// The list's date and view are RETURN CONTEXT for the calendar, never
// filters: the list keeps the shipped "today + 14 days" upcoming
// window. That is why they are parsed and re-emitted here rather than
// added to the list query.

export const SCHEDULE_CALENDAR_PATH = "/owner/schedule";
export const SCHEDULE_LIST_PATH = "/owner/sessions";

export type ScheduleSurface = "calendar" | "list";

export const SCHEDULE_VIEWS = ["day", "week", "month", "agenda"] as const;
export type ScheduleView = (typeof SCHEDULE_VIEWS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real `YYYY-MM-DD` day. The calendar already refused malformed
 * values; the round-trip also drops impossible ones such as
 * `2026-02-30`, so a carried date can never reopen the calendar on a
 * broken window.
 */
export function parseScheduleDate(value: string | undefined): string | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

export function parseScheduleView(value: string | undefined): ScheduleView | undefined {
  return SCHEDULE_VIEWS.find((view) => view === value);
}

/**
 * The one Schedule destination a permission profile can actually open.
 *
 * The calendar needs `attendance.read`; the exception list needs
 * `programs.write`. A profile holding both lands on the calendar, the
 * overview of the job. A profile holding neither has no destination,
 * so callers render no entry at all rather than a refused URL.
 */
export function scheduleDestination(permissions: ReadonlySet<string>): string | undefined {
  if (permissions.has("attendance.read")) return SCHEDULE_CALENDAR_PATH;
  if (permissions.has("programs.write")) return SCHEDULE_LIST_PATH;
  return undefined;
}

/** The calendar URL: the anchor day and the chosen view always survive. */
export function scheduleCalendarHref(input: {
  facilityId?: string;
  date: string;
  view: ScheduleView;
}): string {
  return ownerFacilityHref(
    `${SCHEDULE_CALENDAR_PATH}?view=${input.view}&date=${input.date}`,
    input.facilityId,
  );
}

/**
 * The list URL. `date` and `view` are carried only so the Calendar
 * switch returns the owner to the day they were looking at; omitting
 * them lets the calendar pick its shipped today/week default.
 */
export function scheduleListHref(input: {
  facilityId?: string;
  date?: string;
  view?: ScheduleView;
}): string {
  const params = new URLSearchParams();
  if (input.date) params.set("date", input.date);
  if (input.view) params.set("view", input.view);
  const query = params.toString();
  return ownerFacilityHref(
    query ? `${SCHEDULE_LIST_PATH}?${query}` : SCHEDULE_LIST_PATH,
    input.facilityId,
  );
}
