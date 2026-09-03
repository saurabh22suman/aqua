import { describe, expect, it } from "vitest";
import {
  assertStaff,
  assertManagement,
  assertMembersWrite,
  assertEnquiriesAccess,
} from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/auth/context";

// Phase 5.8 — permission matrix sanity. The four guards in
// lib/auth/permissions.ts are the only authorization check at
// the action layer for the non-platform surfaces (owner,
// coach, receptionist, accountant, worker, parent). This test
// pins their truth table: every (role, action-class) pair,
// every verdict. A future contributor who, say, splits
// MEMBERS_WRITE_ROLES into a new gate and forgets to add a
// negative test turns this red.
//
// The four guards are the standing permission boundary
// between roles. Owner and admin have full access; coach,
// receptionist, worker, accountant, parent have role-specific
// subsets. The matrix below is exhaustive across the six
// non-platform roles this codebase currently supports.

function ctxWith(roleKey: string): Ctx {
  return {
    userId: "00000000-0000-0000-0000-000000000000" as never,
    tenantId: "00000000-0000-0000-0000-000000000000" as never,
    membershipId: "00000000-0000-0000-0000-000000000000",
    roleKey,
    roleId: "00000000-0000-0000-0000-000000000000",
    slug: "",
    allLocations: true,
    locationIds: [],
  };
}

describe("permission matrix (Phase 5.8)", () => {
  describe("assertStaff — 'is a staff member, in any capacity'", () => {
    const ALLOWED = ["owner", "admin", "coach", "receptionist"];
    const DENIED = ["accountant", "worker", "parent"];

    for (const role of ALLOWED) {
      it(`allows ${role}`, () => {
        expect(() => assertStaff(ctxWith(role))).not.toThrow();
      });
    }
    for (const role of DENIED) {
      it(`denies ${role}`, () => {
        expect(() => assertStaff(ctxWith(role))).toThrow(/forbidden/);
      });
    }
  });

  describe("assertManagement — owner/admin only", () => {
    const ALLOWED = ["owner", "admin"];
    const DENIED = ["coach", "receptionist", "accountant", "worker", "parent"];

    for (const role of ALLOWED) {
      it(`allows ${role}`, () => {
        expect(() => assertManagement(ctxWith(role))).not.toThrow();
      });
    }
    for (const role of DENIED) {
      it(`denies ${role}`, () => {
        expect(() => assertManagement(ctxWith(role))).toThrow(/forbidden/);
      });
    }
  });

  describe("assertMembersWrite — owner/admin/receptionist only", () => {
    // Coach can mark attendance but cannot edit members; that
    // distinction is intentional per the seed permission set.
    const ALLOWED = ["owner", "admin", "receptionist"];
    const DENIED = ["coach", "accountant", "worker", "parent"];

    for (const role of ALLOWED) {
      it(`allows ${role}`, () => {
        expect(() => assertMembersWrite(ctxWith(role))).not.toThrow();
      });
    }
    for (const role of DENIED) {
      it(`denies ${role}`, () => {
        expect(() => assertMembersWrite(ctxWith(role))).toThrow(/forbidden/);
      });
    }
  });

  describe("assertEnquiriesAccess — owner/admin/receptionist only", () => {
    const ALLOWED = ["owner", "admin", "receptionist"];
    const DENIED = ["coach", "accountant", "worker", "parent"];

    for (const role of ALLOWED) {
      it(`allows ${role}`, () => {
        expect(() => assertEnquiriesAccess(ctxWith(role))).not.toThrow();
      });
    }
    for (const role of DENIED) {
      it(`denies ${role}`, () => {
        expect(() => assertEnquiriesAccess(ctxWith(role))).toThrow(/forbidden/);
      });
    }
  });
});
