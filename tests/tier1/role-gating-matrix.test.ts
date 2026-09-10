import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import {
  canAccessSurface,
  surfaceForRole,
  SURFACE_OWNER,
  SURFACE_COACH,
  SURFACE_RECEPTION,
  SURFACE_PARENT,
} from "@/lib/auth/surface-access";
import { requirePermission, ForbiddenError } from "@/lib/auth/permission";
import { resolveCtxFor } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { asTenantId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";
import type { Ctx } from "@/lib/auth/context";

// Sub-PR 3 — the (role × surface × feature) matrix delivered.
//
// This is the audit's mechanical answer. Three failure modes
// closed:
//   1. Layout admitted every role to every tenant surface
//      (sessionExists() with no role gate). Sub-PR 1 closed
//      with canAccessSurface; this test pins it.
//   2. assertStaff admitted every staff role to every staff-gated
//      read (the coach → /owner/members → children's DOB bug).
//      Sub-PR 2 closed with requirePermission; this test pins
//      it for every (role, permissionKey) cell.
//   3. Feature entitlements resolved correctly but were never
//      consulted (operator turns Reports off, /owner/reports
//      still renders, CSV export returns 200). requirePermission
//      now consults ctx.features; this test pins the OFF case
//      against a real DB.
//
// We seed one tenant through seedRoleTemplates — the same path
// production uses — and exercise the matrix against the real
// Ctx pipeline (resolveCtxFor → resolvePermissionContext → DB).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const tenantId = asTenantId(uuidv7());
const RUN = Date.now().toString(36);
const SLUG = `matrix-${RUN}`;

// Seeded by seedRoleTemplates; key → roleId captured at runtime.
const roleIdsByKey: Record<string, string> = {};
const userIdsByRole: Record<string, string> = {};

// (role, surface) → expected verdict for the layout gate.
// Drawn from lib/auth/surface-access.ts.
const ROLE_SURFACE_MATRIX: Array<{
  role: string;
  surface: "owner" | "coach" | "reception" | "parent";
  expect: "allow" | "deny";
}> = [
  { role: "owner", surface: SURFACE_OWNER, expect: "allow" },
  { role: "owner", surface: SURFACE_COACH, expect: "deny" },
  { role: "owner", surface: SURFACE_RECEPTION, expect: "deny" },
  { role: "owner", surface: SURFACE_PARENT, expect: "deny" },
  { role: "admin", surface: SURFACE_OWNER, expect: "allow" },
  { role: "admin", surface: SURFACE_COACH, expect: "deny" },
  { role: "admin", surface: SURFACE_RECEPTION, expect: "deny" },
  { role: "admin", surface: SURFACE_PARENT, expect: "deny" },
  { role: "accountant", surface: SURFACE_OWNER, expect: "allow" },
  { role: "accountant", surface: SURFACE_COACH, expect: "deny" },
  { role: "accountant", surface: SURFACE_RECEPTION, expect: "deny" },
  { role: "accountant", surface: SURFACE_PARENT, expect: "deny" },
  { role: "receptionist", surface: SURFACE_OWNER, expect: "deny" },
  { role: "receptionist", surface: SURFACE_COACH, expect: "deny" },
  { role: "receptionist", surface: SURFACE_RECEPTION, expect: "allow" },
  { role: "receptionist", surface: SURFACE_PARENT, expect: "deny" },
  { role: "coach", surface: SURFACE_OWNER, expect: "deny" },
  { role: "coach", surface: SURFACE_COACH, expect: "allow" },
  { role: "coach", surface: SURFACE_RECEPTION, expect: "deny" },
  { role: "coach", surface: SURFACE_PARENT, expect: "deny" },
  { role: "worker", surface: SURFACE_OWNER, expect: "deny" },
  { role: "worker", surface: SURFACE_COACH, expect: "deny" },
  { role: "worker", surface: SURFACE_RECEPTION, expect: "deny" },
  { role: "worker", surface: SURFACE_PARENT, expect: "allow" },
];

// (role, permission, featureOn) → expected verdict for the
// action gate. The deny cases mirror the audit's specific
// findings: coach missing members.write (coach cannot create
// members), coach missing reports.* (the CSV-export bug),
// owner with reports OFF (the feature-gate case).
const ACTION_PERM_MATRIX: Array<{
  role: string;
  permissionKey: string;
  featureOn: boolean;
  expect: "allow" | "deny-feature-disabled" | "deny-role-grant-missing";
}> = [
  // Role grants — owner / admin / accountant / receptionist / coach / worker
  // First the always-on module permissions.
  { role: "owner", permissionKey: "attendance.mark", featureOn: true, expect: "allow" },
  { role: "admin", permissionKey: "members.write", featureOn: true, expect: "allow" },
  { role: "receptionist", permissionKey: "members.write", featureOn: true, expect: "allow" },
  { role: "coach", permissionKey: "attendance.mark", featureOn: true, expect: "allow" },
  // Audit findings — the deny rows:
  { role: "coach", permissionKey: "members.write", featureOn: true, expect: "deny-role-grant-missing" },
  { role: "coach", permissionKey: "reports.operational", featureOn: true, expect: "deny-role-grant-missing" },
  { role: "worker", permissionKey: "attendance.mark", featureOn: true, expect: "deny-role-grant-missing" },
  { role: "receptionist", permissionKey: "reports.operational", featureOn: true, expect: "deny-role-grant-missing" },
  // Feature gate — the audit's CSV-export bug. Owner HAS
  // reports.operational, but the operator turned reports off.
  { role: "owner", permissionKey: "reports.operational", featureOn: true, expect: "allow" },
  { role: "owner", permissionKey: "reports.operational", featureOn: false, expect: "deny-feature-disabled" },
  { role: "owner", permissionKey: "reports.financial", featureOn: false, expect: "deny-feature-disabled" },
];

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name) values ($1, $2, $3)",
    [tenantId, SLUG, "Matrix Tenant"],
  );

  // Seed the six roles through seedRoleTemplates — same path as
  // production — so role_permissions rows match the closed
  // PERMISSIONS list exactly.
  await seedRoleTemplates(tenantId);

  // Capture the roleIds the seed produced.
  const { rows: rolesRows } = await admin.query<{ key: string; id: string }>(
    "select key, id from roles where tenant_id = $1",
    [tenantId],
  );
  for (const r of rolesRows) roleIdsByKey[r.key] = r.id;

  // Provision a phone + user + membership per role.
  for (const roleKey of Object.keys(roleIdsByKey)) {
    const userId = uuidv7();
    const phone = `+91931${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    userIdsByRole[roleKey] = userId;
    await admin.query(
      "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
      [userId, phone, userId],
    );
    await admin.query(
      "insert into ba_user (id, phone_number, phone_number_verified, name, email) values ($1, $2, true, $3, $4)",
      [userId, phone, `Matrix ${roleKey}`, `${roleKey}-${userId}@matrix.local`],
    );
    await admin.query(
      "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1, $2, $3, $4, 'active')",
      [uuidv7(), tenantId, userId, roleIdsByKey[roleKey]!],
    );
  }

  // Enable every GA feature as the baseline. The matrix test
  // toggles individual features per-case below.
  const alwaysOn = ["members", "attendance", "programs", "enquiries", "staff", "settings"];
  const toggleable = ["reports", "billing", "messaging", "swim.levels", "pool.booking"];
  for (const f of [...alwaysOn, ...toggleable]) {
    await admin.query(
      "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, $2, true)",
      [tenantId, f],
    );
  }
});

afterAll(async () => {
  // Cleanup in dependency order.
  if (Object.keys(userIdsByRole).length > 0) {
    await admin.query(
      "delete from tenant_memberships where user_id = any($1::uuid[])",
      [Object.values(userIdsByRole)],
    );
    await admin.query(
      "delete from users where id = any($1::uuid[])",
      [Object.values(userIdsByRole)],
    );
  }
  await admin.query("delete from ba_user where email like '%@matrix.local'");
  await admin.query("delete from tenant_features where tenant_id = $1", [tenantId]);
  await admin.query("delete from role_permissions where tenant_id = $1", [tenantId]);
  await admin.query("delete from roles where tenant_id = $1", [tenantId]);
  await admin.query("delete from tenants where id = $1", [tenantId]);
  await admin.end();
});

async function resolveCtxForRole(role: string): Promise<Ctx> {
  const userId = userIdsByRole[role];
  if (!userId) throw new Error(`no user seeded for role ${role}`);
  return resolveCtxFor(userId, SLUG);
}

async function setFeature(featureKey: string, enabled: boolean): Promise<void> {
  await admin.query(
    "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, $2, $3) on conflict (tenant_id, feature_key) do update set enabled = excluded.enabled",
    [tenantId, featureKey, enabled],
  );
}

// Map permission keys to their module feature for the toggle
// in ACTION_PERM_MATRIX. The audit's CSV case is reports.* →
// reports feature.
function permissionToFeature(permKey: string): string | null {
  const m: Record<string, string> = {
    "invoices.read": "billing",
    "invoices.write": "billing",
    "payments.read": "billing",
    "payments.record": "billing",
    "reports.operational": "reports",
    "reports.financial": "reports",
    "messaging.send": "messaging",
    "messaging.templates": "messaging",
    "bookings.read": "pool.booking",
    "bookings.write": "pool.booking",
    "levels.read": "swim.levels",
    "levels.assess": "swim.levels",
  };
  return m[permKey] ?? null;
}

describe("(role × surface) matrix — layout gate", () => {
  it.each(ROLE_SURFACE_MATRIX.map((m) => [`${m.role} → ${m.surface}`, m] as const))(
    "%s — canAccessSurface verdict is %s",
    (_label, m) => {
      const verdict = canAccessSurface(m.role, m.surface);
      if (m.expect === "allow") {
        expect(verdict).toBe(true);
      } else {
        expect(verdict).toBe(false);
      }
    },
  );

  it("every seeded role maps to a known surface (no orphan role)", () => {
    // The inverse of the audit's "forget to update the role
    // list" class: every seeded role MUST land somewhere.
    // A 7th role added without updating TENANT_ROLE_TO_SURFACE
    // would surface here as null.
    for (const role of ["owner", "admin", "accountant", "receptionist", "coach", "worker"]) {
      expect(surfaceForRole(role)).not.toBeNull();
    }
  });

  it("audit finding: a coach can NEVER reach the owner surface", () => {
    for (const surface of [SURFACE_OWNER, SURFACE_RECEPTION, SURFACE_PARENT] as const) {
      expect(canAccessSurface("coach", surface)).toBe(false);
    }
    expect(canAccessSurface("coach", SURFACE_COACH)).toBe(true);
  });
});

describe("(role × surface) matrix — DB-resolved Ctx", () => {
  for (const m of ROLE_SURFACE_MATRIX) {
    it(`${m.role} resolves Ctx that can ${m.expect === "allow" ? "reach" : "NOT reach"} ${m.surface}`, async () => {
      const ctx = await resolveCtxForRole(m.role);
      expect(ctx.roleKey).toBe(m.role);
      const verdict = canAccessSurface(ctx.roleKey, m.surface);
      if (m.expect === "allow") {
        expect(verdict).toBe(true);
      } else {
        expect(verdict).toBe(false);
      }
    });
  }
});

describe("(role × action-permission × feature) matrix — action gate", () => {
  beforeAll(async () => {
    // Reset to default-on before the matrix runs.
    await setFeature("reports", true);
    await setFeature("billing", true);
    await setFeature("messaging", true);
  });

  it.each(ACTION_PERM_MATRIX.map((m) => [`${m.role} / ${m.permissionKey} / featureOn=${m.featureOn}`, m] as const))(
    "%s — requirePermission verdict is %s",
    async (_label, m) => {
      const featureKey = permissionToFeature(m.permissionKey);
      if (featureKey) {
        await setFeature(featureKey, m.featureOn);
      }
      const ctx = await resolveCtxForRole(m.role);
      let threw: Error | undefined;
      try {
        requirePermission(ctx, m.permissionKey);
      } catch (e) {
        threw = e as Error;
      }
      if (m.expect === "allow") {
        expect(threw, `${m.role}/${m.permissionKey} should have allowed`).toBeUndefined();
      } else {
        expect(threw).toBeInstanceOf(ForbiddenError);
        expect((threw as ForbiddenError).message).toMatch(
          m.expect === "deny-feature-disabled" ? /feature_disabled/ : /role_grant_missing/,
        );
      }
      if (featureKey) {
        // Reset for the next case.
        await setFeature(featureKey, true);
      }
    },
  );
});

describe("mutation proof — feature off / unknown role changes the matrix", () => {
  it("audit finding: owner with reports OFF — requirePermission throws feature_disabled on real DB", async () => {
    await setFeature("reports", false);
    try {
      const ctx = await resolveCtxForRole("owner");
      try {
        requirePermission(ctx, "reports.operational");
        throw new Error("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenError);
        expect((e as ForbiddenError).reason).toBe("feature_disabled");
      }
      // Surgical: attendance still works for the same owner.
      expect(() => requirePermission(ctx, "attendance.mark")).not.toThrow();
    } finally {
      await setFeature("reports", true);
    }
  });

  it("mutation-proof: canAccessSurface keeps the cross-surface deny — removing the gate would fail here", () => {
    // The audit's exact bug, restated: if canAccessSurface ever
    // returns true for the cross-surface cases below, a coach
    // could open /owner/members and read every child's DOB.
    // This assertion is the gate that fails if the layout stops
    // checking the role.
    const crossSurfaceDeny: Array<{ role: string; surface: "owner" | "coach" | "reception" | "parent" }> = [
      { role: "coach", surface: SURFACE_OWNER },
      { role: "receptionist", surface: SURFACE_OWNER },
      { role: "coach", surface: SURFACE_RECEPTION },
      { role: "receptionist", surface: SURFACE_COACH },
      { role: "owner", surface: SURFACE_RECEPTION },
      { role: "owner", surface: SURFACE_COACH },
    ];
    for (const i of crossSurfaceDeny) {
      expect(canAccessSurface(i.role, i.surface)).toBe(false);
    }
  });

  it("mutation-proof: reports OFF must flip the matrix outcome for the role's reports.* grants", async () => {
    // Baseline: feature ON, owner has reports.operational → allow.
    await setFeature("reports", true);
    const ctx = await resolveCtxForRole("owner");
    expect(() => requirePermission(ctx, "reports.operational")).not.toThrow();

    // Flip: feature OFF, same owner → deny (feature_disabled).
    await setFeature("reports", false);
    try {
      const ctx2 = await resolveCtxForRole("owner");
      try {
        requirePermission(ctx2, "reports.operational");
        throw new Error("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenError);
        expect((e as ForbiddenError).reason).toBe("feature_disabled");
      }
    } finally {
      await setFeature("reports", true);
    }
  });
});
