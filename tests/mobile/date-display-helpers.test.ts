import { describe, expect, it } from "vitest";
import {
  formatDateTimeIST,
  formatWallTime12h,
  formatWallTime24hIST,
  formatWeekdayDateIST,
} from "@/lib/time/tz";

// P1-1 / P1-7 (mobile UX audit, 2026-09-12) — three more shared
// display formatters so no call site formats by hand. The audit found
// ISO dates (`2026-09-13`), locale-default datetimes
// (`10/9/2026, 5:30:00 am`), 24-hour wall times with seconds
// (`07:00:00–08:00:00`) and mixed 24h/12h clocks across screens.

describe("formatDateTimeIST", () => {
  it("renders date + 12-hour IST time", () => {
    expect(formatDateTimeIST("2026-09-10T00:00:00.000Z")).toBe(
      "10 Sept 2026, 05:30 am",
    );
  });

  it("keeps the IST calendar date across the UTC midnight boundary", () => {
    expect(formatDateTimeIST("2026-09-11T20:00:00.000Z")).toBe(
      "12 Sept 2026, 01:30 am",
    );
  });
});

describe("formatWeekdayDateIST", () => {
  it("renders a date-only string as weekday, day, month", () => {
    expect(formatWeekdayDateIST("2026-09-13")).toBe("Sun, 13 Sept");
  });

  it("renders an instant in IST", () => {
    expect(formatWeekdayDateIST("2026-09-12T11:30:00.000Z")).toBe("Sat, 12 Sept");
  });
});

describe("formatWallTime24hIST", () => {
  it("renders an instant as IST wall time for time inputs", () => {
    expect(formatWallTime24hIST("2026-09-12T11:30:00.000Z")).toBe("17:00");
    expect(formatWallTime24hIST("2026-09-12T02:05:00.000Z")).toBe("07:35");
  });
});

describe("formatWallTime12h", () => {
  it("renders a DB time with seconds as 12-hour", () => {
    expect(formatWallTime12h("07:00:00")).toBe("7:00 am");
    expect(formatWallTime12h("17:00:00")).toBe("5:00 pm");
  });

  it("renders minute precision without seconds", () => {
    expect(formatWallTime12h("13:05")).toBe("1:05 pm");
  });

  it("renders midnight and noon correctly", () => {
    expect(formatWallTime12h("00:30:00")).toBe("12:30 am");
    expect(formatWallTime12h("12:00:00")).toBe("12:00 pm");
  });

  it("passes an unrecognised value through unchanged", () => {
    expect(formatWallTime12h("not-a-time")).toBe("not-a-time");
  });
});
