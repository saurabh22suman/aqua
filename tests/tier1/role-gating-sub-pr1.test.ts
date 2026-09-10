import { describe, expect, it } from "vitest";
import {
  hasPermission,
  hasFeature,
  requirePermission,
  ForbiddenError,
} from "@/lib/auth/permission";
import {
  canAccessSurface,
  surfaceForRole,
  SURFACE_OWNER,
  SURFACE_COACH,
  SURFACE_RECEPTION,
  SURFACE_PARENT,
} from "@/lib/auth/surface-access";
import type { Ctx } from "@/lib/auth/context";

// Sub-PR 1 unit tests — the resolve helpers and the layout gate
// without going through the database. The matrix test (sub-PR 3)
// wires both layers end-to-end with seeded tenants.

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
    permissions: new Set<string>(),
    features: new Set<string>(),
  };
}

describe("lib/auth/surface-access (sub-PR 1)", () => {
  it("maps the seeded roles to the right surface", () => {
    expect(surfaceForRole("owner")).toBe(SURFACE_OWNER);
    expect(surfaceForRole("admin")).toBe(SURFACE_OWNER);
    // K3 follow-up: accountant still routes through /owner.
    expect(surfaceForRole("accountant")).toBe(SURFACE_OWNER);
    expect(surfaceForRole("receptionist")).toBe(SURFACE_RECEPTION);
    expect(surfaceForRole("coach")).toBe(SURFACE_COACH);
    expect(surfaceForRole("worker")).toBe(SURFACE_PARENT);
  });

  it("canAccessSurface: owner/admin/accountant -> owner", () => {
    expect(canAccessSurface("owner", SURFACE_OWNER)).toBe(true);
    expect(canAccessSurface("admin", SURFACE_OWNER)).toBe(true);
    expect(canAccessSurface("accountant", SURFACE_OWNER)).toBe(true);
    // Cross-surface denial is the audit's exact finding.
    expect(canAccessSurface("coach", SURFACE_OWNER)).toBe(false);
    expect(canAccessSurface("receptionist", SURFACE_OWNER)).toBe(false);
    expect(canAccessSurface("worker", SURFACE_OWNER)).toBe(false);
  });

  it("canAccessSurface: coach -> coach, denies everyone else", () => {
    expect(canAccessSurface("coach", SURFACE_COACH)).toBe(true);
    expect(canAccessSurface("owner", SURFACE_COACH)).toBe(false);
    expect(canAccessSurface("admin", SURFACE_COACH)).toBe(false);
    expect(canAccessSurface("receptionist", SURFACE_COACH)).toBe(false);
  });

  it("canAccessSurface: receptionist -> reception, denies everyone else", () => {
    expect(canAccessSurface("receptionist", SURFACE_RECEPTION)).toBe(true);
    expect(canAccessSurface("owner", SURFACE_RECEPTION)).toBe(false);
    expect(canAccessSurface("coach", SURFACE_RECEPTION)).toBe(false);
    expect(canAccessSurface("admin", SURFACE_RECEPTION)).toBe(false);
  });

  it("canAccessSurface: worker -> parent (placeholder home), but not coach", () => {
    expect(canAccessSurface("worker", SURFACE_PARENT)).toBe(true);
    expect(canAccessSurface("coach", SURFACE_PARENT)).toBe(false);
    expect(canAccessSurface("owner", SURFACE_PARENT)).toBe(false);
    expect(canAccessSurface("receptionist", SURFACE_PARENT)).toBe(false);
  });

  it("unknown roles deny every surface (fail closed)", () => {
    // Adding a 5th role without updating TENANT_ROLE_TO_SURFACE
    // yields 404 on every surface — the audit's "forget to update
    // the role list" class closed at the source.
    expect(surfaceForRole("intern")).toBeNull();
    expect(canAccessSurface("intern", SURFACE_OWNER)).toBe(false);
    expect(canAccessSurface("intern", SURFACE_COACH)).toBe(false);
    expect(canAccessSurface("intern", SURFACE_RECEPTION)).toBe(false);
    expect(canAccessSurface("intern", SURFACE_PARENT)).toBe(false);
  });
});

describe("lib/auth/permission — hasPermission / hasFeature (sub-PR 1)", () => {
  it("hasPermission reads ctx.permissions", () => {
    const ctx = ctxWith("coach");
    ctx.permissions.add("attendance.mark");
    ctx.permissions.add("members.read");
    expect(hasPermission(ctx, "attendance.mark")).toBe(true);
    expect(hasPermission(ctx, "members.read")).toBe(true);
    expect(hasPermission(ctx, "members.write")).toBe(false);
  });

  it("hasFeature reads ctx.features", () => {
    const ctx = ctxWith("owner");
    ctx.permissions.add("reports.financial");
    ctx.features.add("reports");
    ctx.features.add("billing");
    expect(hasFeature(ctx, "reports")).toBe(true);
    expect(hasFeature(ctx, "billing")).toBe(true);
    expect(hasFeature(ctx, "cafe.pos")).toBe(false);
  });
});

describe("lib/auth/permission — requirePermission (sub-PR 1)", () => {
  it("returns silently when the role has the permission", () => {
    const ctx = ctxWith("coach");
    ctx.permissions.add("attendance.mark");
    ctx.permissions.add("members.read");
    ctx.features.add("attendance");
    ctx.features.add("members");
    expect(() => requirePermission(ctx, "attendance.mark")).not.toThrow();
    expect(() => requirePermission(ctx, "members.read")).not.toThrow();
  });

  it("throws role_grant_missing when the role lacks the permission", () => {
    const ctx = ctxWith("coach");
    ctx.permissions.add("attendance.mark");
    ctx.features.add("attendance");
    try {
      requirePermission(ctx, "members.write");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).reason).toBe("role_grant_missing");
      expect((e as ForbiddenError).permissionKey).toBe("members.write");
    }
  });

  it("throws feature_disabled when the role has the permission but the feature is off", () => {
    // The audit's exact bug: an operator turns Reports off but the
    // /owner/reports page still renders and CSV export returns 200.
    // Here the role has reports.financial but the feature key
    // `reports` is NOT in ctx.features. requirePermission throws
    // feature_disabled; the layout's nav rendering checks
    // hasFeature separately.
    const ctx = ctxWith("owner");
    ctx.permissions.add("reports.financial");
    try {
      requirePermission(ctx, "reports.financial");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).reason).toBe("feature_disabled");
    }
  });

  it("throws role_grant_missing for a permission key not in the closed PERMISSIONS list", () => {
    // Closed list — db/seed-platform.ts is the canonical source.
    // A typo'd permission string must fail closed, never silently
    // pass.
    const ctx = ctxWith("owner");
    ctx.permissions.add("totally.fake.permission");
    try {
      requirePermission(ctx, "totally.fake.permission");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).reason).toBe("role_grant_missing");
    }
  });

  it("always-on modules (attendance, members, ...) bypass the feature check", () => {
    // These modules are GA on every tenant by construction. requirePermission
    // for one of their permissions does NOT consult ctx.features for them —
    // turning off `attendance` for a tenant is not a supported operator
    // action (the seed grants every GA feature). The audit's
    // "operator turning Reports off" case still flips on `reports`
    // because reports is NOT in ALWAYS_ON_MODULES.
    const ctx = ctxWith("coach");
    ctx.permissions.add("attendance.mark");
    expect(() => requirePermission(ctx, "attendance.mark")).not.toThrow();
  });
});
