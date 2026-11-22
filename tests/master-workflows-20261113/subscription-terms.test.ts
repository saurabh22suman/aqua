import { describe, expect, it } from "vitest";
import { resolveSubscriptionEndDate, SESSION_PACK_VALIDITY_DAYS } from "@/lib/subscription-terms";

describe("inclusive subscription end dates", () => {
  it("uses duration, leap days and the existing 30-day fallback", () => {
    expect(resolveSubscriptionEndDate({kind:"duration",startsOn:"2024-02-01",durationDays:30})).toBe("2024-03-01");
    expect(resolveSubscriptionEndDate({kind:"term",startsOn:"2024-02-29",durationDays:null})).toBe("2024-03-29");
  });
  it("uses the 90-day pack validity and honours an explicit end", () => {
    expect(SESSION_PACK_VALIDITY_DAYS).toBe(90);
    expect(resolveSubscriptionEndDate({kind:"sessions",startsOn:"2024-12-01",durationDays:null})).toBe("2025-02-28");
    expect(resolveSubscriptionEndDate({kind:"duration",startsOn:"2024-02-01",durationDays:30,endsOn:"2024-04-10"})).toBe("2024-04-10");
  });
});
