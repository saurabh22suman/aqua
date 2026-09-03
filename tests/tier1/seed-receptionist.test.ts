import { describe, expect, it } from "vitest";
import { LOGIN_USERS } from "../../scripts/seed";

// Phase 3.7 — receptionist seed verification. The previously-
// shipped scripts/seed.ts hardcoded a LOGIN_USERS list with
// owner, coach, parent — no receptionist. The assertStaff
// permission path (lib/auth/permissions.ts) lists receptionist
// as a STAFF_ROLE, but the live seeded database had no
// receptionist row, so any e2e walkthrough against the demo
// tenant bypassed that role and could not catch regressions of
// its permissions. The seed fix in scripts/seed.ts adds
// +919000000005 as the receptionist login; this test pins the
// LIST SHAPE so a future contributor removing the receptionist
// row is caught here, not in a future e2e drift.
//
// Source-level check on the closed-set of seeded logins. The
// receptionist row in particular is what the grep catches.

describe("seed.LOGIN_USERS (Phase 3.7)", () => {
  it("includes every role the demo academy needs to exercise permission paths end-to-end", () => {
    const roles = LOGIN_USERS.map((u) => u.role);
    expect(roles).toContain("owner");
    expect(roles).toContain("coach");
    expect(roles).toContain("parent");
    expect(roles).toContain("receptionist");
  });

  it("uses +91 country code for every login phone", () => {
    for (const u of LOGIN_USERS) {
      expect(u.phone.startsWith("+91")).toBe(true);
    }
  });

  it("phones are unique — duplicate phone would collide on the users table's unique constraint", () => {
    const phones = LOGIN_USERS.map((u) => u.phone);
    expect(new Set(phones).size).toBe(phones.length);
  });

  it("the receptionist role is wired to a real login phone (the fix this PR documents)", () => {
    const receptionist = LOGIN_USERS.find((u) => u.role === "receptionist");
    expect(receptionist?.phone).toBeTruthy();
    expect(receptionist?.phone).toMatch(/^\+\d{8,15}$/);
  });
});
