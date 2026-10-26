import { describe, expect, it } from "vitest";
import {
  comparisonText,
  periodBuckets,
  resolveOwnerPeriod,
} from "@/lib/time/owner-periods";

// Owner Home period boundaries. Every case pins an IST wall-clock instant
// so the comparison windows cannot drift with the runner's timezone.
const IST = (iso: string) => new Date(`${iso}+05:30`).getTime();

describe("owner periods — Day", () => {
  it("compares today against yesterday at the same elapsed local time", () => {
    const period = resolveOwnerPeriod("day", IST("2026-10-26T09:15:00"));
    expect(period.current.fromDate).toBe("2026-10-26");
    expect(period.current.toDate).toBe("2026-10-26");
    expect(period.previous.fromDate).toBe("2026-10-25");
    // Both windows are exactly 9h15m long.
    const current = Date.parse(period.current.toIso) - Date.parse(period.current.fromIso);
    const previous = Date.parse(period.previous.toIso) - Date.parse(period.previous.fromIso);
    expect(previous).toBe(current);
    // Yesterday's window ends at 09:15 IST.
    expect(period.previous.toIso).toBe(new Date(IST("2026-10-25T09:15:00")).toISOString());
    expect(period.comparisonLabel).toBe("DoD");
  });

  it("buckets the day hourly and stops at the current hour", () => {
    const period = resolveOwnerPeriod("day", IST("2026-10-26T09:15:00"));
    const buckets = periodBuckets(period);
    expect(buckets).toHaveLength(24);
    expect(buckets[0]!.label).toBe("12am");
    expect(buckets[9]!.label).toBe("9am");
  });
});

describe("owner periods — Week", () => {
  it("starts on Monday even when today is Sunday", () => {
    const period = resolveOwnerPeriod("week", IST("2026-11-01T10:00:00"));
    expect(period.current.fromDate).toBe("2026-10-26");
    expect(period.current.toDate).toBe("2026-11-01");
    expect(period.previous.fromDate).toBe("2026-10-19");
    expect(period.comparisonLabel).toBe("WoW");
    expect(periodBuckets(period)).toHaveLength(7);
  });

  it("compares the same elapsed span of last week", () => {
    const period = resolveOwnerPeriod("week", IST("2026-10-28T08:00:00"));
    const current = Date.parse(period.current.toIso) - Date.parse(period.current.fromIso);
    const previous = Date.parse(period.previous.toIso) - Date.parse(period.previous.fromIso);
    expect(previous).toBe(current);
  });
});

describe("owner periods — Month", () => {
  it("caps the previous month at its real end and explains it", () => {
    const period = resolveOwnerPeriod("month", IST("2026-03-31T12:00:00"));
    expect(period.current.fromDate).toBe("2026-03-01");
    expect(period.previous.fromDate).toBe("2026-02-01");
    // 31 March elapsed is longer than February, so the comparison stops
    // at the end of 28 February.
    expect(period.previous.capped).toBe(true);
    expect(period.previous.toDate).toBe("2026-02-28");
    expect(period.previous.toIso).toBe(new Date(IST("2026-03-01T00:00:00")).toISOString());
    expect(period.previous.capNote).toContain("28 Feb 2026");
    expect(period.comparisonLabel).toBe("MoM");
  });

  it("keeps an uncapped month-to-date comparison inside the previous month", () => {
    const period = resolveOwnerPeriod("month", IST("2026-10-15T10:00:00"));
    expect(period.previous.capped).toBe(false);
    expect(period.previous.toDate).toBe("2026-09-15");
    expect(period.previous.capNote).toBeNull();
  });
});

describe("comparison text — never infinite growth", () => {
  it("says there were no previous collections instead of a percentage", () => {
    expect(comparisonText(120000, 0)).toBe(
      "No previous collections in the comparison range",
    );
    expect(comparisonText(120000, null)).toBe(
      "No previous collections in the comparison range",
    );
    expect(comparisonText(0, 0)).toBe("No collections in either range");
  });

  it("reports a real directional change when the previous range had money", () => {
    expect(comparisonText(500000, 400000)).toBe("Up 25% vs the previous range");
    expect(comparisonText(300000, 400000)).toBe("Down 25% vs the previous range");
    expect(comparisonText(400000, 400000)).toBe("Level with the previous range");
  });
});
