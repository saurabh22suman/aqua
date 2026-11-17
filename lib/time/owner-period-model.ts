import { formatDateIST, formatTimeIST, todayInZone } from "@/lib/time/tz";

// Owner Home period MODEL.
//
// The windows themselves are computed in owner-periods.ts. This module
// owns the vocabulary around them: which keys exist, which of them the
// Owner Home toggle offers, what each window is called, and the shapes
// the windows are returned in. One module, one job — a label and the
// computation that reads it cannot drift apart.

export type OwnerPeriodKey = "day" | "last7" | "week" | "month";

export const OWNER_PERIODS: OwnerPeriodKey[] = ["day", "last7", "week", "month"];

/**
 * The ranges the Owner Home toggle OFFERS.
 *
 * Three distinct choices, not four: "Day", "Last 7 days" and "Month" are
 * unambiguous next to each other. The Monday-to-now "week" window stays
 * a supported key (the URL and the service still accept `period=week`,
 * and links that already carry it keep working), but it is not offered
 * as a second seven-ish button beside "Last 7 days" — an owner would
 * not know which of the two seven-day windows they were reading.
 */
export const OWNER_HOME_RANGE_KEYS: OwnerPeriodKey[] = ["day", "last7", "month"];

/** The number of IST calendar dates in the "Last 7 days" window. */
export const LAST7_DAYS = 7;

/** The button label for each window. */
export const OWNER_PERIOD_LABEL: Record<OwnerPeriodKey, string> = {
  day: "Day",
  last7: "Last 7 days",
  week: "Week",
  month: "Month",
};

/**
 * The window's own name, in the words the window is read by — "Today",
 * "Last 7 days", "This week", "This month".
 *
 * ONE source: the period's tab label and the Owner Home toolbar's state
 * sentence both read it, so the toolbar can name a window the toggle
 * does not offer without saying anything the window does not say about
 * itself.
 */
export const OWNER_PERIOD_TAB_LABEL: Record<OwnerPeriodKey, string> = {
  day: "Today",
  last7: "Last 7 days",
  week: "This week",
  month: "This month",
};

export type PeriodRange = {
  /** Inclusive start instant. */
  fromIso: string;
  /** Exclusive end instant. */
  toIso: string;
  /** Inclusive IST calendar dates, for date-based reads. */
  fromDate: string;
  toDate: string;
};

export type OwnerPeriod = {
  key: OwnerPeriodKey;
  tabLabel: string;
  comparisonLabel: "DoD" | "7-day" | "WoW" | "MoM";
  comparisonMeaning: string;
  current: PeriodRange;
  previous: PeriodRange & { capped: boolean; capNote: string | null };
};

export type ChartBucket = {
  key: string;
  label: string;
  fullLabel: string;
  startIso: string;
  endIso: string;
};

export function isOwnerPeriodKey(value: unknown): value is OwnerPeriodKey {
  return value === "day" || value === "last7" || value === "week" || value === "month";
}

/**
 * The plain-language name of a comparison, from its short label.
 *
 * ONE source, so the phrase next to a comparison cannot drift from the
 * range it describes. The full meaning of each comparison (with its
 * exact ranges) lives in the "How this is measured" disclosure.
 */
export function comparisonExpansionFor(label: string): string {
  if (label === "DoD") return "day over day";
  if (label === "7-day") return "the seven days before";
  if (label === "WoW") return "week over week";
  if (label === "MoM") return "month over month";
  return "the previous range";
}

const TZ = "Asia/Kolkata";

/** The IST calendar date an instant falls on. */
export function dateOfInstant(instant: Date): string {
  return todayInZone(TZ, instant.getTime() - 1);
}

/** Local (IST) label for an inclusive instant range. */
export function formatInstantRange(fromIso: string, toIsoExclusive: string): string {
  const from = new Date(fromIso);
  const lastIncluded = new Date(new Date(toIsoExclusive).getTime() - 1);
  const sameDay = dateOfInstant(from) === dateOfInstant(lastIncluded);
  const start = `${formatDateIST(from)}, ${formatTimeIST(from)}`;
  const end = sameDay
    ? formatTimeIST(lastIncluded)
    : `${formatDateIST(lastIncluded)}, ${formatTimeIST(lastIncluded)}`;
  return `${start} – ${end}`;
}
