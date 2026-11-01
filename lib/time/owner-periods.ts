import {
  addDays,
  formatDateIST,
  todayInZone,
  weekdayOf,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";
import {
  LAST7_DAYS,
  OWNER_PERIOD_TAB_LABEL,
  dateOfInstant,
  type ChartBucket,
  type OwnerPeriod,
  type OwnerPeriodKey,
} from "@/lib/time/owner-period-model";

// Owner Home period windows and their comparisons.
//
// The owner picks Day / Last 7 days / Week / Month. Every comparison is "same elapsed
// local time" so a figure is never compared against a full period that
// has not finished yet:
//   Day   (DoD) — today 00:00 → now  vs  yesterday 00:00 → yesterday at
//                 the same wall-clock time.
//   Last 7 (7-day) — today and the preceding six IST calendar dates,
//                 00:00 → now  vs  the seven IST dates before that, to
//                 the same elapsed time. NOT Monday-to-now: the window
//                 counts calendar dates, so it does not move with the
//                 start of the week.
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
//
// The period MODEL — the keys, the labels and the shapes — lives in
// lib/time/owner-period-model.ts. It is re-exported here so this
// module's public surface does not change.

export {
  LAST7_DAYS,
  OWNER_HOME_RANGE_KEYS,
  OWNER_PERIODS,
  OWNER_PERIOD_LABEL,
  OWNER_PERIOD_TAB_LABEL,
  comparisonExpansionFor,
  formatInstantRange,
  isOwnerPeriodKey,
  type ChartBucket,
  type OwnerPeriod,
  type OwnerPeriodKey,
  type PeriodRange,
} from "@/lib/time/owner-period-model";

const TZ = "Asia/Kolkata";

function startOfDay(dateIso: string): Date {
  return zonedWallTimeToInstant(dateIso, "00:00", TZ);
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
      tabLabel: OWNER_PERIOD_TAB_LABEL.day,
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

  if (key === "last7") {
    // Today and the preceding six IST calendar dates. The window is a
    // count of CALENDAR DATES, not a count of weeks, so it does not
    // move with the start of the week: on Wednesday 28 October it
    // starts on Thursday 22 October, while "this week" starts on
    // Monday 26 October.
    const fromDate = addDays(today, -(LAST7_DAYS - 1));
    const start = startOfDay(fromDate);
    const elapsed = Math.max(0, nowMs - start.getTime());
    const previousFromDate = addDays(fromDate, -LAST7_DAYS);
    const previousStart = startOfDay(previousFromDate);
    const previousEnd = new Date(previousStart.getTime() + elapsed);
    return {
      key,
      tabLabel: OWNER_PERIOD_TAB_LABEL.last7,
      comparisonLabel: "7-day",
      comparisonMeaning:
        "Seven-day comparison — these seven calendar days against the seven days before them, to the same elapsed time",
      current: {
        fromIso: start.toISOString(),
        toIso: now.toISOString(),
        fromDate,
        toDate: today,
      },
      previous: {
        fromIso: previousStart.toISOString(),
        toIso: previousEnd.toISOString(),
        fromDate: previousFromDate,
        toDate: dateOfInstant(previousEnd),
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
      tabLabel: OWNER_PERIOD_TAB_LABEL.week,
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
    tabLabel: OWNER_PERIOD_TAB_LABEL.month,
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
  if (period.key === "week" || period.key === "last7") {
    // Seven chronological DAILY buckets for both week-shaped windows:
    // "this week" starts on Monday, "Last 7 days" starts on the sixth
    // preceding calendar date. A day with no marks is unknown, never 0%.
    const from = period.current.fromDate;
    const count = period.key === "last7" ? LAST7_DAYS : 7;
    return Array.from({ length: count }, (_, index) => {
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
