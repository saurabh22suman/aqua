// @vitest-environment node
//
// The owner-insights window: real Gregorian calendar dates, half-open,
// in the TENANT's timezone.
//
// The quick review found the window schema accepted impossible dates —
// the shape check only asked for four digits, two digits, two digits,
// so "2026-02-30" (a February that does not exist) and "2026-13-01"
// passed. A window that names a day the calendar does not have is a
// silently empty or silently wrong window: the query asks for a day
// that never happened and reports "nothing to show" as if the club
// had no attendance.
//
// This file is the pure unit level of that contract — no database, no
// session. The service and the action levels are covered in
// tests/owner-insights.test.ts and tests/owner-insights-actions.test.ts.

import { describe, expect, it } from "vitest";
import {
  ownerInsightInputSchema,
  periodWindowUtc,
} from "@/lib/services/owner-insights-period";

const TZ = "Asia/Kolkata";

describe("owner insights window — real calendar dates", () => {
  it("accepts a real day in a real month", () => {
    const parsed = ownerInsightInputSchema.parse({
      from: "2026-06-01",
      to: "2026-07-01",
    });
    expect(parsed.from).toBe("2026-06-01");
    expect(parsed.to).toBe("2026-07-01");
  });

  it("accepts a leap day in a leap year", () => {
    // 2024 is a leap year: February 29 exists.
    expect(
      ownerInsightInputSchema.safeParse({ from: "2024-02-29", to: "2024-03-01" })
        .success,
    ).toBe(true);
  });

  it("rejects a leap day in a year that is not a leap year", () => {
    // 2023 is not a leap year: February 29 never happened.
    expect(
      ownerInsightInputSchema.safeParse({ from: "2023-02-29", to: "2023-03-01" })
        .success,
    ).toBe(false);
    // 1900 is divisible by 100 and NOT by 400 — not a leap year.
    expect(
      ownerInsightInputSchema.safeParse({ from: "1900-02-29", to: "1900-03-01" })
        .success,
    ).toBe(false);
    // 2000 is divisible by 400 — a leap year.
    expect(
      ownerInsightInputSchema.safeParse({ from: "2000-02-29", to: "2000-03-01" })
        .success,
    ).toBe(true);
  });

  it("rejects a day that does not exist in its month", () => {
    const impossible = [
      "2026-02-30", // February never has 30 days
      "2026-04-31", // April has 30
      "2026-06-31", // June has 30
      "2026-09-31", // September has 30
      "2026-11-31", // November has 30
      "2023-04-31",
      "2026-01-32",
      "2026-01-00",
      "2026-00-10",
      "2026-13-01",
    ];
    for (const date of impossible) {
      expect(
        ownerInsightInputSchema.safeParse({ from: date, to: "2026-12-31" }).success,
        `${date} must not pass as a calendar date`,
      ).toBe(false);
      expect(
        ownerInsightInputSchema.safeParse({ from: "2026-01-01", to: date }).success,
        `${date} must not pass as a calendar date`,
      ).toBe(false);
    }
  });

  it("still rejects a shape that is not an ISO calendar date", () => {
    for (const date of ["not-a-date", "2026-1-1", "2026-01-01T00:00:00Z", "26-01-01", "2026/01/01", ""]) {
      expect(
        ownerInsightInputSchema.safeParse({ from: date, to: "2026-12-31" }).success,
        `${date} must not pass as a window start`,
      ).toBe(false);
    }
  });

  it("keeps the half-open window: the end is the day AFTER the last one", () => {
    expect(
      ownerInsightInputSchema.safeParse({ from: "2026-06-01", to: "2026-06-01" })
        .success,
    ).toBe(false);
    expect(
      ownerInsightInputSchema.safeParse({ from: "2026-07-01", to: "2026-06-01" })
        .success,
    ).toBe(false);
    // A single-day window is from = D, to = D+1.
    expect(
      ownerInsightInputSchema.safeParse({ from: "2026-06-01", to: "2026-06-02" })
        .success,
    ).toBe(true);
  });
});

describe("owner insights window — tenant-timezone boundaries", () => {
  it("opens at 00:00 in the tenant's timezone, not at UTC midnight", () => {
    // 2026-06-01 00:00 IST = 2026-05-31 18:30 UTC.
    const window = periodWindowUtc({ from: "2026-06-01", to: "2026-07-01" }, TZ);
    expect(window.fromUtc.toISOString()).toBe("2026-05-31T18:30:00.000Z");
    // The window CLOSES at the start of the `to` day — the same
    // half-open shape, so the last included day is 2026-06-30.
    expect(window.toUtc.toISOString()).toBe("2026-06-30T18:30:00.000Z");
  });

  it("keeps the boundary instants across a leap day", () => {
    const window = periodWindowUtc({ from: "2024-02-29", to: "2024-03-01" }, TZ);
    // 2024-02-29 00:00 IST = 2024-02-28 18:30 UTC.
    expect(window.fromUtc.toISOString()).toBe("2024-02-28T18:30:00.000Z");
    // 2024-03-01 00:00 IST = 2024-02-29 18:30 UTC — the window is one
    // day long, and that day is the leap day itself.
    expect(window.toUtc.toISOString()).toBe("2024-02-29T18:30:00.000Z");
  });

  it("honours the tenant's zone rather than a fixed offset", () => {
    const ist = periodWindowUtc({ from: "2026-06-01", to: "2026-07-01" }, "Asia/Kolkata");
    const utc = periodWindowUtc({ from: "2026-06-01", to: "2026-07-01" }, "UTC");
    expect(ist.fromUtc.toISOString()).toBe("2026-05-31T18:30:00.000Z");
    expect(utc.fromUtc.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    // The same calendar day, two different instants: the window follows
    // the club's day, not the server's.
    expect(utc.fromUtc.getTime() - ist.fromUtc.getTime()).toBe(5.5 * 60 * 60 * 1000);
  });
});
