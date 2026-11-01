// The Ops activity filter's DATE MODEL — the impossible-date finding.
//
// A legacy link carries an INSTANT ("2026-03-01T17:30:00+05:30") and
// the filter is a DATE filter now, so the instant is normalised to the
// IST calendar day it names. The normalisation must be STRICT: the
// parser JavaScript ships with rolls an impossible day over —
// `new Date("2026-02-30T12:00:00+05:30")` is 2 March, not an invalid
// date — so a permissive normalisation would read a DIFFERENT day from
// the one the link named.
//
// The rules this file pins:
//
//   * an instant whose local date does not exist is REFUSED, never
//     rolled into the next month;
//   * a real instant still names the IST day it falls on;
//   * a real calendar date is still accepted, and an impossible one is
//     still refused.

import { describe, expect, it } from "vitest";
import { normalizeActivityDate } from "@/components/ops/ops-activity-date";

describe("the Ops activity date model — the day an instant names", () => {
  it("refuses an instant whose local date does not exist", () => {
    // 30 February, 31 April and 29 February 2026 are not days.
    expect(normalizeActivityDate("2026-02-30T12:00:00+05:30")).toBeNull();
    expect(normalizeActivityDate("2026-04-31T00:00:00+05:30")).toBeNull();
    expect(normalizeActivityDate("2026-02-29T12:00:00+05:30")).toBeNull();
  });

  it("still names the IST day a real instant falls on", () => {
    expect(normalizeActivityDate("2026-03-01T17:30:00+05:30")).toBe("2026-03-01");
    // 23:30 UTC is already the next day in IST (+05:30).
    expect(normalizeActivityDate("2026-02-28T23:30:00Z")).toBe("2026-03-01");
    expect(normalizeActivityDate("2026-03-01T00:00:00+05:30")).toBe("2026-03-01");
  });

  it("keeps the calendar-date rules it already had", () => {
    expect(normalizeActivityDate("2026-03-01")).toBe("2026-03-01");
    expect(normalizeActivityDate("2024-02-29")).toBe("2024-02-29");
    expect(normalizeActivityDate("2026-02-30")).toBeNull();
    expect(normalizeActivityDate("not-a-date")).toBeNull();
    expect(normalizeActivityDate("")).toBeNull();
    expect(normalizeActivityDate(undefined)).toBeNull();
  });
});
