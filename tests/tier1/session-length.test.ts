import { describe, expect, it } from "vitest";
import {
  isSessionExpiredForRole,
  RECEPTIONIST_SESSION_MAX_AGE_MS,
} from "@/lib/auth/permissions";

// Session-length contract (architecture §6.1): owner/coach/admin ride
// the 30-day sliding better-auth session; receptionist sessions die
// 12h after login because the front desk is a shared device. Pure
// function of (role, timestamps) -- no session, no database, so this
// file needs no fixtures and no cleanup.

const HOUR_MS = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("isSessionExpiredForRole", () => {
  it("caps the constant at 12 hours", () => {
    expect(RECEPTIONIST_SESSION_MAX_AGE_MS).toBe(12 * HOUR_MS);
  });

  it.each(["owner", "admin", "coach", "worker", "accountant", "unknown"])(
    "never expires %s, however old the session",
    (roleKey) => {
      expect(isSessionExpiredForRole(roleKey, NOW - 30 * 24 * HOUR_MS, NOW)).toBe(
        false,
      );
    },
  );

  it("keeps a fresh receptionist session alive", () => {
    expect(isSessionExpiredForRole("receptionist", NOW - HOUR_MS, NOW)).toBe(false);
  });

  it("treats exactly-12h as alive (strictly-greater boundary)", () => {
    expect(
      isSessionExpiredForRole(
        "receptionist",
        NOW - RECEPTIONIST_SESSION_MAX_AGE_MS,
        NOW,
      ),
    ).toBe(false);
  });

  it("expires a receptionist session 1ms past 12h", () => {
    expect(
      isSessionExpiredForRole(
        "receptionist",
        NOW - RECEPTIONIST_SESSION_MAX_AGE_MS - 1,
        NOW,
      ),
    ).toBe(true);
  });

  it("expires an overnight receptionist session", () => {
    expect(
      isSessionExpiredForRole("receptionist", NOW - 20 * HOUR_MS, NOW),
    ).toBe(true);
  });
});
