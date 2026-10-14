import { describe, expect, it } from "vitest";
import {
  FACILITY_COOKIE,
  isFacilityScopedPath,
  parseFacilityValue,
  resolveFacilityValue,
} from "@/lib/facility";
import {
  COLLECTIONS_DRILL,
  compactPaiseINR,
  formatDrillHref,
} from "@/lib/dashboard-charts";

// W1-6 continuation — the ONE facility-resolution rule every page
// shares: URL first, cookie second, malformed values dropped. The
// scanner-facing tests live here because a regression in either half
// reintroduces the "filter looks broken" bug the owner reported.

const ID = "22222222-2222-7222-8222-222222222222";
const OTHER_ID = "11111111-1111-7111-8111-111111111111";

describe("facility value resolution", () => {
  it("accepts a UUID from the URL", () => {
    expect(resolveFacilityValue(ID, undefined)).toBe(ID);
  });

  it("falls back to the cookie when the URL is silent", () => {
    expect(resolveFacilityValue(undefined, ID)).toBe(ID);
    expect(resolveFacilityValue("all", ID)).toBe(ID);
  });

  it("drops malformed values from both sources", () => {
    expect(parseFacilityValue("not-a-uuid")).toBeUndefined();
    expect(resolveFacilityValue("not-a-uuid", "also-bad")).toBeUndefined();
    expect(parseFacilityValue(null)).toBeUndefined();
  });

  it("keeps the cookie name stable — it is persisted client-side", () => {
    expect(FACILITY_COOKIE).toBe("aqua_facility");
  });

  it("accepts any well-formed UUID, not just one", () => {
    expect(parseFacilityValue(ID)).toBe(ID);
    expect(parseFacilityValue(OTHER_ID)).toBe(OTHER_ID);
  });
});

describe("switcher route scope", () => {
  it("shows on the screens that scope data by facility", () => {
    for (const path of [
      "/owner",
      "/owner/members",
      "/owner/members/m1",
      "/owner/fees",
      "/owner/programs",
      "/owner/reports",
      "/owner/reports/collections",
    ]) {
      expect(isFacilityScopedPath(path), path).toBe(true);
    }
  });

  it("stays hidden where a picker would change nothing", () => {
    for (const path of [
      "/owner/settings",
      "/owner/settings/locations",
      "/owner/announcements",
      "/owner/onboarding",
      "/owner/staff",
      "/owner/staff/roster",
      "/owner/schedule",
      "/owner/sessions",
    ]) {
      expect(isFacilityScopedPath(path), path).toBe(false);
    }
  });
});

describe("chart drill-through templates", () => {
  it("fills {from}/{to} with the day and the next day", () => {
    expect(formatDrillHref(COLLECTIONS_DRILL, "2026-10-07")).toBe(
      `/owner/fees?tab=transactions&from=2026-10-07&to=2026-10-08`,
    );
  });

  it("handles month and year boundaries", () => {
    expect(formatDrillHref("/x?from={from}&to={to}", "2026-12-31")).toBe(
      "/x?from=2026-12-31&to=2027-01-01",
    );
  });
});

describe("ECharts axis money formatting", () => {
  it("treats input as paise, never rupees", () => {
    // ₹1,500 = 150000 paise. The browser pass caught the 100× bug.
    expect(compactPaiseINR(150000)).toBe("₹1.5k");
    expect(compactPaiseINR(100000)).toBe("₹1k");
    expect(compactPaiseINR(50000)).toBe("₹500");
    expect(compactPaiseINR(0)).toBe("₹0");
  });

  it("compacts lakh-scale values", () => {
    expect(compactPaiseINR(15000000)).toBe("₹1.5L");
    expect(compactPaiseINR(10000000)).toBe("₹1L");
  });
});

