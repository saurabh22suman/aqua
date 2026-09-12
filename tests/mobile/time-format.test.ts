import { describe, expect, it } from "vitest";
import { formatDateIST, formatTimeIST } from "@/lib/time/tz";

// F3 (mobile UX plan v2, Phase 0) — zone-aware display formatters.
// The audit found /owner/sessions rendering UTC (`11:30`) instead of
// IST (`05:00 pm`) because the list used getUTCHours/getUTCMinutes.
// The fix introduces these two helpers in the shared tz module so
// every surface (owner sessions, coach schedule, receipts, offline
// register) has one definition of "how a time looks in India".

describe("formatTimeIST", () => {
  it("renders a UTC instant in Asia/Kolkata 12-hour form", () => {
    expect(formatTimeIST("2026-09-12T11:30:00.000Z")).toBe("05:00 pm");
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(formatTimeIST(new Date("2026-09-12T02:05:00.000Z"))).toBe(
      "07:35 am",
    );
  });

  it("crosses the date boundary correctly (UTC evening → IST next day)", () => {
    expect(formatTimeIST("2026-09-12T20:15:00.000Z")).toBe("01:45 am");
  });
});

describe("formatDateIST", () => {
  it("renders an unambiguous Indian date (day month year)", () => {
    expect(formatDateIST("2026-09-12T11:30:00.000Z")).toBe("12 Sept 2026");
  });

  it("rolls the calendar day when the UTC instant is already tomorrow in IST", () => {
    expect(formatDateIST("2026-09-11T20:00:00.000Z")).toBe("12 Sept 2026");
  });
});
