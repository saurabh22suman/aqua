import { addDays, formatPeriodRangeIST } from "@/lib/time/tz";

// The insights window: the last 30 club days, ending today.
//
// `from` is inclusive and `to` is EXCLUSIVE — the same convention the
// two read models use (lib/services/owner-insights-period.ts), so the
// window the section prints and the window the service read are ONE
// window and can never disagree by a day.
//
// The window is deliberately its own, and not the Home's Day / Week /
// Month control: those are operating windows for the trend band, and a
// single day carries no batch picture. A month of club days is the
// smallest window that answers "how are the batches and the enquiry
// pipeline doing", and it is stated on screen, so it is never a
// hidden period.

export const INSIGHT_WINDOW_DAYS = 30;

export type InsightWindow = {
  /** Inclusive window start (tenant-local calendar day). */
  from: string;
  /** Exclusive window end (tenant-local calendar day). */
  to: string;
};

export function insightWindow(today: string): InsightWindow {
  return {
    from: addDays(today, -(INSIGHT_WINDOW_DAYS - 1)),
    to: addDays(today, 1),
  };
}

/** The human range, with the tenant's own timezone named. */
export function insightWindowLabel(
  window: InsightWindow,
  timezone: string,
): string {
  return `${formatPeriodRangeIST(window.from, window.to)} (${timezone})`;
}

/**
 * "the last 30 days" — derived from the constant, so the words can
 * never drift away from the window that was actually read.
 */
export function insightWindowPhrase(): string {
  return `the last ${INSIGHT_WINDOW_DAYS} days`;
}
