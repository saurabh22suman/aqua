// Owner Home — the greeting is an ARRIVAL, not a farewell.
//
// Actual Chrome review: at 04:40 IST (before the 05:30 session) Home said
// "Good night". The approved time-of-day heading stays; overnight is now a
// neutral "Hello", and the early morning window starts at 04:00 so an owner
// opening Home before the first session is greeted for the morning they are
// starting. No personal name, no new identity query.

import { describe, expect, it } from "vitest";
import { greetingFor } from "@/components/owner-home/greeting";

describe("Owner Home — the greeting bands (Asia/Kolkata)", () => {
  it("welcomes an arrival overnight and treats the early morning as morning", () => {
    // 00:30 IST — overnight is a greeting, never "Good night".
    expect(greetingFor(new Date("2026-11-01T19:00:00Z"))).toBe("Hello");
    // 04:40 IST — the owner is opening Home before an early session.
    expect(greetingFor(new Date("2026-11-01T23:10:00Z"))).toBe("Good morning");
  });

  it("keeps the existing day bands unchanged", () => {
    // 10:00 IST
    expect(greetingFor(new Date("2026-11-02T04:30:00Z"))).toBe("Good morning");
    // 14:00 IST
    expect(greetingFor(new Date("2026-11-02T08:30:00Z"))).toBe("Good afternoon");
    // 19:00 IST
    expect(greetingFor(new Date("2026-11-02T13:30:00Z"))).toBe("Good evening");
  });
});
