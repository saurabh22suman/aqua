import {
  addDays,
  formatDateIST,
  formatTimeIST,
  todayInZone,
  weekdayOf,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";

// Owner Home period windows and their comparisons.
//
// The owner picks Day / Week / Month. Every comparison is "same elapsed
// local time" so a figure is never compared against a full period that
// has not finished yet:
//   Day   (DoD) — today 00:00 → now  vs  yesterday 00:00 → yesterday at
//                 the same wall-clock time.
//   Week  (WoW) — Monday 00:00 → now  vs  previous Monday 00:00 → the
//                 same elapsed time.
//   Month (MoM) — 1st 00:00 → now  vs  previous month 1st 00:00 → the
//                 same elapsed time, capped at the end of the previous
//                 month (a 31st cannot exist in a 28-day month).
//
// All arithmetic is Asia/Kolkata (the tenant display zone); the ranges
// returned are exact instants (UTC) plus their IST labels, so the
// figures, the chart buckets and the printed comparison range all come
// from one window.

export type OwnerPeriodKey = "day" | "week" | "month";
export const OWNER_PERIODS: OwnerPeriodKey[] = ["day", "week", "month"];

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
  comparisonLabel: "DoD" | "WoW" | "MoM";
  comparisonMeaning: string;
  current: PeriodRange;
  previous: PeriodRange & { capped: boolean; capNote: string | null };
};

export const OWNER_PERIOD_LABEL: Record<OwnerPeriodKey, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

const TZ = "Asia/Kolkata";

export function isOwnerPeriodKey(value: unknown): value is OwnerPeriodKey {
  return value === "day" || value === "week" || value === "month";
}

function startOfDay(dateIso: string): Date {
  return zonedWallTimeToInstant(dateIso, "00:00", TZ);
}

function dateOfInstant(instant: Date): string {
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

function addMonths(dateIso: string, months: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function resolveOwnerPeriod(
  key: OwnerPeriodKey,
  nowMs: number = Date.now(),
): OwnerPeriod {
  const today = todayInZone(TZ, nowMs);
  const now = new Date(nowMs);

  if (key === "day") {
    const start = startOfDay(today);
    const elapsed = Math.max(0, nowMs - start.getTime());
    const previousDate = addDays(today, -1);
    const previousStart = startOfDay(previousDate);
    return {
      key,
      tabLabel: "Today",
      comparisonLabel: "DoD",
      comparisonMeaning: "Day over day — today against yesterday at the same elapsed local time",
      current: {
        fromIso: start.toISOString(),
        toIso: now.toISOString(),
        fromDate: today,
        toDate: today,
      },
      previous: {
        fromIso: previousStart.toISOString(),
        toIso: new Date(previousStart.getTime() + elapsed).toISOString(),
        fromDate: previousDate,
        toDate: previousDate,
        capped: false,
        capNote: null,
      },
    };
  }

  if (key === "week") {
    const weekday = weekdayOf(today); // 0 = Sunday
    const mondayDate = addDays(today, -((weekday + 6) % 7));
    const start = startOfDay(mondayDate);
    const elapsed = Math.max(0, nowMs - start.getTime());
    const previousMonday = addDays(mondayDate, -7);
    const previousStart = startOfDay(previousMonday);
    const previousEnd = new Date(previousStart.getTime() + elapsed);
    return {
      key,
      tabLabel: "This week",
      comparisonLabel: "WoW",
      comparisonMeaning:
        "Week over week — this Monday-to-now against last week's same elapsed span",
      current: {
        fromIso: start.toISOString(),
        toIso: now.toISOString(),
        fromDate: mondayDate,
        toDate: today,
      },
      previous: {
        fromIso: previousStart.toISOString(),
        toIso: previousEnd.toISOString(),
        fromDate: previousMonday,
        toDate: dateOfInstant(previousEnd),
        capped: false,
        capNote: null,
      },
    };
  }

  const first = `${today.slice(0, 8)}01`;
  const start = startOfDay(first);
  const elapsed = Math.max(0, nowMs - start.getTime());
  const previousFirst = addMonths(first, -1);
  const previousStart = startOfDay(previousFirst);
  // Exclusive end of the previous month = this month's first instant.
  const previousMonthEnd = startOfDay(first);
  const idealEnd = previousStart.getTime() + elapsed;
  const capped = idealEnd >= previousMonthEnd.getTime();
  const previousEnd = new Date(Math.min(idealEnd, previousMonthEnd.getTime()));
  const capNote = capped
    ? `Previous month ended before the same elapsed time; compared ${formatDateIST(
        previousFirst,
      )} 00:00 – ${formatDateIST(new Date(previousMonthEnd.getTime() - 1))} end of month.`
    : null;
  return {
    key,
    tabLabel: "This month",
    comparisonLabel: "MoM",
    comparisonMeaning:
      "Month over month — this month-to-date against the same elapsed span of the previous month",
    current: {
      fromIso: start.toISOString(),
      toIso: now.toISOString(),
      fromDate: first,
      toDate: today,
    },
    previous: {
      fromIso: previousStart.toISOString(),
      toIso: previousEnd.toISOString(),
      fromDate: previousFirst,
      toDate: dateOfInstant(previousEnd),
      capped,
      capNote,
    },
  };
}

export type ChartBucket = {
  key: string;
  label: string;
  fullLabel: string;
  startIso: string;
  endIso: string;
};

const HOUR_LABEL = (hour: number) => {
  const suffix = hour < 12 ? "am" : "pm";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${suffix}`;
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Buckets for the selected period, covering the whole current period so
 * the axis is stable while the day/week/month fills in. Buckets that
 * have not happened yet simply contain no data.
 */
export function periodBuckets(period: OwnerPeriod): ChartBucket[] {
  if (period.key === "day") {
    const date = period.current.fromDate;
    const dayStart = startOfDay(date);
    return Array.from({ length: 24 }, (_, hour) => {
      const start = new Date(dayStart.getTime() + hour * 3_600_000);
      return {
        key: String(hour).padStart(2, "0"),
        label: HOUR_LABEL(hour),
        fullLabel: `${date} ${String(hour).padStart(2, "0")}:00`,
        startIso: start.toISOString(),
        endIso: new Date(start.getTime() + 3_600_000).toISOString(),
      };
    });
  }
  if (period.key === "week") {
    const from = period.current.fromDate;
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(from, index);
      return {
        key: date,
        label: `${WEEKDAY[weekdayOf(date)]} ${Number(date.slice(8))}`,
        fullLabel: formatDateIST(date),
        startIso: startOfDay(date).toISOString(),
        endIso: startOfDay(addDays(date, 1)).toISOString(),
      };
    });
  }
  const first = period.current.fromDate;
  const daysInMonth = new Date(
    Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0),
  ).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const date = addDays(first, index);
    return {
      key: date,
      label: String(Number(date.slice(8))),
      fullLabel: formatDateIST(date),
      startIso: startOfDay(date).toISOString(),
      endIso: startOfDay(addDays(date, 1)).toISOString(),
    };
  });
}

/** True when the previous period recorded nothing — never "∞% growth". */
export function comparisonText(
  currentPaise: number,
  previousPaise: number | null,
): string {
  if (previousPaise === null || previousPaise === 0) {
    return currentPaise > 0 ? "No previous collections in the comparison range" : "No collections in either range";
  }
  const delta = currentPaise - previousPaise;
  const pct = Math.round((delta / previousPaise) * 100);
  if (pct === 0) return "Level with the previous range";
  return `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct)}% vs the previous range`;
}
