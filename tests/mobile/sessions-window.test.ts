import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { daysAheadWindow } from "@/lib/time/tz";

// P0-3 residue (mobile UX audit, 2026-09-12) — /owner/sessions computed
// its 14-day window with `new Date().toISOString().slice(0, 10)`, i.e.
// the UTC calendar date. Between 00:00 and 05:30 IST that is
// yesterday's IST date, so the list quietly included sessions that had
// already run. The window must come from the tenant's timezone.
//
// Mutation proof: reverting the page to `toISOString().slice(0, 10)`
// turns the source guard at the bottom red; changing `daysAheadWindow`
// to use UTC turns the boundary cases red.
describe("daysAheadWindow (tenant-timezone 14-day window)", () => {
  it("starts on the IST calendar day, not the UTC one, just after midnight IST", () => {
    // 2026-09-11T19:30:00Z is 2026-09-12 01:00 IST.
    const window = daysAheadWindow("Asia/Kolkata", 14, Date.parse("2026-09-11T19:30:00Z"));
    expect(window.fromDate).toBe("2026-09-12");
    expect(window.toDate).toBe("2026-09-26");
  });

  it("crosses the IST midnight boundary correctly late in the UTC day", () => {
    // 2026-09-12T20:00:00Z is 2026-09-13 01:30 IST.
    const window = daysAheadWindow("Asia/Kolkata", 14, Date.parse("2026-09-12T20:00:00Z"));
    expect(window.fromDate).toBe("2026-09-13");
    expect(window.toDate).toBe("2026-09-27");
  });

  it("matches the UTC date when UTC and IST agree", () => {
    const window = daysAheadWindow("Asia/Kolkata", 14, Date.parse("2026-09-12T06:00:00Z"));
    expect(window.fromDate).toBe("2026-09-12");
    expect(window.toDate).toBe("2026-09-26");
  });
});

describe("sessions page uses the shared window (source guard)", () => {
  it("does not compute the date range with toISOString", () => {
    const source = readFileSync("app/(owner)/owner/sessions/page.tsx", "utf8");
    expect(source).not.toContain("toISOString().slice(0, 10)");
    expect(source).toContain("daysAheadWindow");
  });
});
