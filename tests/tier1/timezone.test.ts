import { describe, expect, it } from "vitest";
import {
  addDays,
  isMinor,
  todayInZone,
  weekdayOf,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";

describe("timezone helpers", () => {
  it("07:00 wall time in Asia/Kolkata lands at 01:30 UTC regardless of server clock", () => {
    const instant = zonedWallTimeToInstant("2026-08-25", "07:00", "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-08-25T01:30:00.000Z");
  });

  it("the same wall time in a different tenant timezone produces a different instant", () => {
    const ist = zonedWallTimeToInstant("2026-08-25", "07:00", "Asia/Kolkata");
    const est = zonedWallTimeToInstant("2026-08-25", "07:00", "America/New_York");
    expect(est.getTime()).not.toBe(ist.getTime());
    expect(est.toISOString()).toBe("2026-08-25T11:00:00.000Z");
  });

  it("handles the DST edge without shifting other zones", () => {
    const beforeDst = zonedWallTimeToInstant("2026-03-07", "07:00", "America/New_York");
    const afterDst = zonedWallTimeToInstant("2026-03-09", "07:00", "America/New_York");
    expect(beforeDst.toISOString()).toBe("2026-03-07T12:00:00.000Z");
    expect(afterDst.toISOString()).toBe("2026-03-09T11:00:00.000Z");
  });

  it("todayInZone can differ from UTC's date near midnight", () => {
    const justBeforeIstMidnight = Date.UTC(2026, 7, 25, 18, 29, 0);
    const justAfterIstMidnight = Date.UTC(2026, 7, 25, 18, 31, 0);

    expect(todayInZone("Asia/Kolkata", justBeforeIstMidnight)).toBe("2026-08-25");
    expect(todayInZone("Asia/Kolkata", justAfterIstMidnight)).toBe("2026-08-26");
    expect(todayInZone("UTC", justBeforeIstMidnight)).toBe("2026-08-25");
  });

  it("derives minor status using the tenant timezone boundary", () => {
    const dob18thBirthdayToday = "2008-08-26";
    const atUtcBeforeBoundary = Date.UTC(2026, 7, 25, 17, 0, 0);
    const atUtcAfterBoundary = Date.UTC(2026, 7, 25, 19, 0, 0);

    expect(isMinor(dob18thBirthdayToday, "Asia/Kolkata", atUtcBeforeBoundary)).toBe(true);
    expect(isMinor(dob18thBirthdayToday, "Asia/Kolkata", atUtcAfterBoundary)).toBe(false);
  });

  it("weekday and addDays agree with UTC calendar math on ISO dates", () => {
    expect(weekdayOf("2026-08-25")).toBe(2);
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });
});
