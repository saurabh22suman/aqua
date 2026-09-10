import { describe, expect, it } from "vitest";
import {
  hasPermission,
  hasFeature,
  requirePermission,
  ForbiddenError,
} from "@/lib/auth/permission";
import { isSessionExpiredForRole, RECEPTIONIST_SESSION_MAX_AGE_MS } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/auth/context";

// Sub-PR 2 — the four role-key guards (assertStaff, assertManagement,
// assertMembersWrite, assertEnquiriesAccess) are deleted. The matrix
// pins their replacements at the helper level:
//   - requirePermission reads ctx.permissions and ctx.features
//   - isSessionExpiredForRole is the only session-freshness check
//     remaining (receptionist 12h cap)
// Sub-PR 3 grows this into a (role × surface × feature) matrix
// asserted end-to-end against the seeded database.

function ctxWith(roleKey: string, permissions: string[] = [], features: string[] = []): Ctx {
  return {
    userId: "00000000-0000-0000-0000-000000000000" as never,
    tenantId: "00000000-0000-0000-0000-000000000000" as never,
    membershipId: "00000000-0000-0000-0000-000000000000",
    roleKey,
    roleId: "00000000-0000-0000-0000-000000000000",
    slug: "",
    allLocations: true,
    locationIds: [],
    permissions: new Set(permissions),
    features: new Set(features),
  };
}

describe("isSessionExpiredForRole (the only remaining role-key check)", () => {
  it("receptionist past TTL → expired", () => {
    const now = Date.now();
    expect(
      isSessionExpiredForRole(
        "receptionist",
        now - RECEPTIONIST_SESSION_MAX_AGE_MS - 1,
        now,
      ),
    ).toBe(true);
  });
  it("receptionist within TTL → fresh", () => {
    const now = Date.now();
    expect(
      isSessionExpiredForRole(
        "receptionist",
        now - RECEPTIONIST_SESSION_MAX_AGE_MS + 60_000,
        now,
      ),
    ).toBe(false);
  });
  it("any other role → never expired by this check", () => {
    const now = Date.now();
    for (const role of ["owner", "admin", "coach", "accountant", "worker", "parent"]) {
      expect(
        isSessionExpiredForRole(role, now - 10 * 365 * 24 * 60 * 60 * 1000, now),
      ).toBe(false);
    }
  });
});

describe("requirePermission (the deleted assertXxx replacement)", () => {
  it("throws role_grant_missing when the role lacks the permission", () => {
    // The audit's exact finding: assertStaff admitted coach to
    // every staff-gated read. requirePermission narrows that to
    // specific permission keys. A coach without members.write
    // cannot mutate members.
    const ctx = ctxWith("coach", ["attendance.mark"], ["attendance"]);
    try {
      requirePermission(ctx, "members.write");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).reason).toBe("role_grant_missing");
    }
  });

  it("throws feature_disabled when the role has the permission but the feature is off", () => {
    // The audit's exact bug: an operator turns Reports off but
    // /owner/reports still renders and CSV returns 200 with data.
    const ctx = ctxWith("owner", ["reports.operational"], []);
    try {
      requirePermission(ctx, "reports.operational");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).reason).toBe("feature_disabled");
    }
  });

  it("returns silently when role + feature are both present", () => {
    const ctx = ctxWith("coach", ["attendance.mark"], ["attendance"]);
    expect(() => requirePermission(ctx, "attendance.mark")).not.toThrow();
  });

  it("always-on modules bypass the feature check", () => {
    // members / attendance / programs / enquiries / staff / settings
    // are GA on every tenant — turning them off is not a supported
    // operator action. The audit's "Reports off" case still trips
    // because reports is NOT in the always-on set.
    const ctx = ctxWith("coach", ["attendance.mark"], []);
    expect(() => requirePermission(ctx, "attendance.mark")).not.toThrow();
  });
});

describe("hasPermission / hasFeature (UI gate)", () => {
  it("hasPermission reads ctx.permissions", () => {
    const ctx = ctxWith("coach", ["members.read"]);
    expect(hasPermission(ctx, "members.read")).toBe(true);
    expect(hasPermission(ctx, "members.write")).toBe(false);
  });

  it("hasFeature reads ctx.features", () => {
    const ctx = ctxWith("owner", [], ["reports"]);
    expect(hasFeature(ctx, "reports")).toBe(true);
    expect(hasFeature(ctx, "cafe.pos")).toBe(false);
  });
});
