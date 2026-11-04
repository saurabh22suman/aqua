import { describe, expect, it } from "vitest";
import {
  periodBuckets,
  resolveOwnerPeriod,
} from "@/lib/time/owner-periods";

// Owner Home trend band — the Last 7 days range.
//
// The defect this file pins: the dashboard defaulted to "Day" and offered
// "Week" (Monday-to-now). Relabelling either would not make a seven-day
// window, so the range itself is asserted: today plus the preceding six IST
// calendar dates, seven chronological daily buckets, today partial, and an
// equivalent previous elapsed range.
//
// Every case pins an IST wall-clock instant so the window cannot drift with
// the runner's timezone.
const IST = (iso: string) => new Date(`${iso}+05:30`).getTime();

describe("owner periods — Last 7 days", () => {
  it("covers today and the preceding six IST calendar dates", () => {
    const period = resolveOwnerPeriod("last7", IST("2026-10-31T09:15:00"));
    expect(period.current.fromDate).toBe("2026-10-25");
    expect(period.current.toDate).toBe("2026-10-31");
    expect(period.current.fromIso).toBe(
      new Date(IST("2026-10-25T00:00:00")).toISOString(),
    );
    expect(period.current.toIso).toBe(
      new Date(IST("2026-10-31T09:15:00")).toISOString(),
    );
  });

  it("buckets seven chronological daily buckets, oldest first, today partial", () => {
    const period = resolveOwnerPeriod("last7", IST("2026-10-31T09:15:00"));
    const buckets = periodBuckets(period);
    expect(buckets).toHaveLength(7);
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    // Each bucket is one IST calendar day; today runs to the next midnight
    // but the READ stops at "now", so today is the partial bucket.
    expect(buckets[0]!.startIso).toBe(
      new Date(IST("2026-10-25T00:00:00")).toISOString(),
    );
    expect(buckets[0]!.endIso).toBe(
      new Date(IST("2026-10-26T00:00:00")).toISOString(),
    );
    expect(buckets[6]!.startIso).toBe(
      new Date(IST("2026-10-31T00:00:00")).toISOString(),
    );
    expect(buckets[6]!.endIso).toBe(
      new Date(IST("2026-11-01T00:00:00")).toISOString(),
    );
  });

  it("is not Monday-to-now — the window starts on the sixth preceding date", () => {
    // 28 October 2026 is a Wednesday.
    const last7 = resolveOwnerPeriod("last7", IST("2026-10-28T08:00:00"));
    const week = resolveOwnerPeriod("week", IST("2026-10-28T08:00:00"));
    expect(last7.current.fromDate).toBe("2026-10-22");
    expect(week.current.fromDate).toBe("2026-10-26");
    expect(last7.current.fromDate).not.toBe(week.current.fromDate);
  });

  it("compares the equivalent previous elapsed range", () => {
    const period = resolveOwnerPeriod("last7", IST("2026-10-28T08:00:00"));
    expect(period.previous.fromDate).toBe("2026-10-15");
    // The previous range runs for the same elapsed span, so it ends at
    // the same wall-clock time on the seventh date before the window.
    expect(period.previous.toDate).toBe("2026-10-21");
    const current =
      Date.parse(period.current.toIso) - Date.parse(period.current.fromIso);
    const previous =
      Date.parse(period.previous.toIso) - Date.parse(period.previous.fromIso);
    expect(previous).toBe(current);
  });

  it("keeps the IST calendar boundary when UTC has already rolled over", () => {
    // 31 October 00:15 IST is still 30 October in UTC.
    const period = resolveOwnerPeriod("last7", IST("2026-10-31T00:15:00"));
    expect(period.current.toDate).toBe("2026-10-31");
    expect(period.current.fromDate).toBe("2026-10-25");
    expect(periodBuckets(period).at(-1)!.key).toBe("2026-10-31");
  });

  it("crosses a month and a year boundary", () => {
    const period = resolveOwnerPeriod("last7", IST("2026-01-02T09:00:00"));
    expect(period.current.fromDate).toBe("2025-12-27");
    expect(period.current.toDate).toBe("2026-01-02");
    const buckets = periodBuckets(period);
    expect(buckets).toHaveLength(7);
    expect(buckets[0]!.key).toBe("2025-12-27");
    expect(buckets[6]!.key).toBe("2026-01-02");
  });

  it("names the range and the comparison in plain words", () => {
    const period = resolveOwnerPeriod("last7", IST("2026-10-28T08:00:00"));
    expect(period.tabLabel).toBe("Last 7 days");
    expect(period.comparisonLabel).toBe("7-day");
    expect(period.comparisonMeaning).toMatch(/seven/i);
  });

  it("keeps the shorter and longer ranges available around it", () => {
    const now = IST("2026-10-28T08:00:00");
    expect(resolveOwnerPeriod("day", now).current.fromDate).toBe("2026-10-28");
    expect(resolveOwnerPeriod("month", now).current.fromDate).toBe("2026-10-01");
    expect(resolveOwnerPeriod("week", now).current.fromDate).toBe("2026-10-26");
  });
});
