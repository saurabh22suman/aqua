import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedRoleTemplates } from "@/lib/services/roles";
import { ForbiddenError } from "@/lib/auth/permission";
import { NotFoundError } from "@/lib/auth/context";
import { privilegedFixturePool } from "../db/privileged-fixture";

import { listMembersAction, listLocationsAction } from "@/lib/actions/people";
import { listStaffAction } from "@/lib/actions/staff";
import { listPlansAction, listPlanTemplatesAction } from "@/lib/actions/membership-plans";
import { listPaymentQrsAction } from "@/lib/actions/payment-qrs";
import { listOwnerVisibleConfigAction } from "@/lib/actions/owner-config";
import { listActivitiesAction } from "@/lib/actions/activities";
import { listAnnouncementsAction } from "@/lib/actions/announcements";
import { listBookableFacilitiesAction } from "@/lib/actions/bookings";
import { listSkillLaddersAction } from "@/lib/actions/skill-ladder";
import { getTodayAction } from "@/lib/actions/coach";
import { listLeaveTypesAction } from "@/lib/actions/leave";

// Tenant staff role x action matrix.
//
// The Ops console is the control plane; this is the OTHER side of the
// product: what a club's own staff may do. The rules that matter:
//
//   * the role's GRANT SET decides (role_permissions), never the role
//     key and never what the page happens to hide;
//   * a feature that is switched OFF for the tenant denies the action
//     too (the entitlement layer);
//   * membership status decides whether the caller has a context at
//     all — a revoked membership is effective immediately.
//
// Every expectation below is written TWICE: once as the hard-coded
// allow-list (read from lib/services/roles.ts's role templates and
// lib/auth/action-permissions.ts's action map), and once computed from
// the role_permissions rows the database actually holds. The test
// asserts the two agree BEFORE it asserts the runtime behaviour — so a
// drift in the catalogue and a drift in the code cannot hide behind
// each other.
//
// Only actions whose input parses successfully are used: an action that
// returns early on invalid input never reaches its permission check, so
// it would report "allowed" for every role and the matrix would be
// worthless.

const { authUser } = vi.hoisted(() => ({ authUser: { betterAuthId: "" } }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: authUser.betterAuthId },
        session: { createdAt: new Date() },
      }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const admin = privilegedFixturePool;

const RUN = Date.now().toString(36);
const tenantId = uuidv7();
const tenantSlug = `audit-roles-${RUN}`;
const locationId = uuidv7();

const ROLES = [
  "owner",
  "admin",
  "accountant",
  "receptionist",
  "coach",
  "curriculum_lead",
  "worker",
] as const;

type RoleKey = (typeof ROLES)[number];

const betterAuthIds = new Map<RoleKey, string>();
const userIds = new Map<RoleKey, string>();
const membershipIds: string[] = [];

type MatrixEntry = {
  action: string;
  permission: string;
  /** The roles whose template carries this permission. */
  allowed: RoleKey[];
  run: () => Promise<unknown>;
};

const MATRIX: MatrixEntry[] = [
  {
    action: "listMembersAction",
    permission: "members.read",
    allowed: ["owner", "admin", "accountant", "receptionist"],
    run: () => listMembersAction({}),
  },
  {
    action: "listLocationsAction",
    permission: "members.read",
    allowed: ["owner", "admin", "accountant", "receptionist"],
    run: () => listLocationsAction(),
  },
  {
    action: "listAnnouncementsAction",
    permission: "members.read",
    allowed: ["owner", "admin", "accountant", "receptionist"],
    run: () => listAnnouncementsAction(),
  },
  {
    action: "listStaffAction",
    permission: "staff.read",
    allowed: ["owner", "admin"],
    run: () => listStaffAction({}),
  },
  {
    action: "listPlansAction",
    permission: "settings.read",
    allowed: ["owner", "admin", "accountant", "receptionist"],
    run: () => listPlansAction(),
  },
  {
    action: "listPlanTemplatesAction",
    permission: "settings.read",
    allowed: ["owner", "admin", "accountant", "receptionist"],
    run: () => listPlanTemplatesAction(),
  },
  {
    action: "listOwnerVisibleConfigAction",
    permission: "settings.read",
    allowed: ["owner", "admin", "accountant", "receptionist"],
    run: () => listOwnerVisibleConfigAction(),
  },
  {
    action: "listPaymentQrsAction",
    permission: "settings.read",
    allowed: ["owner", "admin", "accountant", "receptionist"],
    run: () => listPaymentQrsAction(),
  },
  {
    action: "listActivitiesAction",
    permission: "settings.read",
    allowed: ["owner", "admin", "accountant", "receptionist"],
    run: () => listActivitiesAction(undefined),
  },
  {
    action: "listBookableFacilitiesAction",
    permission: "bookings.read",
    allowed: ["owner", "admin", "receptionist"],
    run: () => listBookableFacilitiesAction(),
  },
  {
    action: "listSkillLaddersAction",
    permission: "levels.read",
    allowed: ["owner", "admin", "coach", "curriculum_lead"],
    run: () => listSkillLaddersAction(),
  },
  {
    action: "getTodayAction",
    permission: "attendance.read",
    allowed: ["owner", "admin", "receptionist", "coach", "curriculum_lead"],
    run: () => getTodayAction(),
  },
  {
    action: "listLeaveTypesAction",
    permission: "staff.self",
    allowed: [...ROLES],
    run: () => listLeaveTypesAction(),
  },
];

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'Audit Roles', 'trial')",
    [tenantId, tenantSlug],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, kind, is_primary) values ($1, $2, 'Audit Pool', 'club', true)",
    [locationId, tenantId],
  );
  // The standard plan grants every GA feature, so the feature layer is
  // satisfied and the matrix measures the ROLE layer only.
  await admin.query(
    "update tenants set plan_id = (select id from plans where key = 'standard') where id = $1",
    [tenantId],
  );
  await seedRoleTemplates(tenantId as never);

  for (const role of ROLES) {
    const roleRow = (
      await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1 and key = $2",
        [tenantId, role],
      )
    ).rows[0];
    if (!roleRow) throw new Error(`missing role ${role}`);
    const betterAuthId = `audit-role-${role}-${RUN}`;
    const userId = uuidv7();
    await admin.query(
      "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
      [userId, `audit-role-${role}-${RUN}`, betterAuthId],
    );
    const membershipId = uuidv7();
    await admin.query(
      "insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status) values ($1, $2, $3, $4, true, 'active')",
      [membershipId, tenantId, userId, roleRow.id],
    );
    betterAuthIds.set(role, betterAuthId);
    userIds.set(role, userId);
    membershipIds.push(membershipId);
  }
});

afterAll(async () => {
  await admin.query("delete from tenant_memberships where id = any($1)", [
    membershipIds,
  ]);
  await admin.query("delete from users where better_auth_id like 'audit-role-%'", []);
  await admin.query("delete from role_permissions where tenant_id = $1", [tenantId]);
  await admin.query("delete from roles where tenant_id = $1", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1", [tenantId]);
  await admin.query("delete from tenants where id = $1", [tenantId]);
});

async function grantedPermissions(role: RoleKey): Promise<Set<string>> {
  const rows = await admin.query<{ permission_key: string }>(
    `select rp.permission_key from role_permissions rp
     join roles r on r.id = rp.role_id
     where rp.tenant_id = $1 and r.key = $2`,
    [tenantId, role],
  );
  return new Set(rows.rows.map((r) => r.permission_key));
}

describe("tenant staff role x action matrix", () => {
  it("the hard-coded allow-lists agree with the role_permissions rows in the database", async () => {
    const drift: string[] = [];
    for (const entry of MATRIX) {
      for (const role of ROLES) {
        const grants = await grantedPermissions(role);
        const fromDb = grants.has(entry.permission);
        const fromTable = entry.allowed.includes(role);
        if (fromDb !== fromTable) {
          drift.push(
            `${role} / ${entry.action} (${entry.permission}): catalogue says ${fromTable ? "allow" : "deny"}, database says ${fromDb ? "allow" : "deny"}`,
          );
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it("every action is allowed for exactly the roles the matrix says, and denied for the rest", async () => {
    const failures: string[] = [];
    for (const entry of MATRIX) {
      for (const role of ROLES) {
        authUser.betterAuthId = betterAuthIds.get(role)!;
        const shouldAllow = entry.allowed.includes(role);
        let denied = false;
        try {
          await entry.run();
        } catch (err) {
          if (err instanceof ForbiddenError) {
            denied = true;
          } else {
            // A different failure (missing fixture data) is not a
            // permission decision — record it so it cannot be mistaken
            // for "allowed".
            failures.push(
              `${role} / ${entry.action}: unexpected ${(err as Error).name}: ${(err as Error).message}`,
            );
            continue;
          }
        }
        if (denied === shouldAllow) {
          failures.push(
            `${role} / ${entry.action} (${entry.permission}): expected ${shouldAllow ? "allow" : "deny"}, got ${denied ? "deny" : "allow"}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("a revoked membership loses access immediately, without a re-login", async () => {
    const membershipId = membershipIds[0];
    const before = await admin.query<{ status: string }>(
      "select status from tenant_memberships where id = $1",
      [membershipId],
    );
    expect(before.rows[0]?.status).toBe("active");
    authUser.betterAuthId = betterAuthIds.get("owner")!;
    await expect(listMembersAction({})).resolves.toBeDefined();

    await admin.query(
      "update tenant_memberships set status = 'revoked' where id = $1",
      [membershipId],
    );
    let refused = false;
    let unexpected = "";
    try {
      await listMembersAction({});
    } catch (err) {
      refused = err instanceof NotFoundError;
      if (!refused) {
        unexpected = `${(err as Error).name}: ${(err as Error).message}`;
      }
    }
    expect(unexpected).toBe("");
    expect(refused).toBe(true);

    // Reactivating restores access with the SAME session — revocation is
    // a per-request decision, not a session wipe.
    await admin.query(
      "update tenant_memberships set status = 'active' where id = $1",
      [membershipId],
    );
    await expect(listMembersAction({})).resolves.toBeDefined();
  });

  it("a coach does NOT get the full member roster", async () => {
    authUser.betterAuthId = betterAuthIds.get("coach")!;
    let refused = false;
    try {
      await listMembersAction({});
    } catch (err) {
      refused = err instanceof ForbiddenError;
    }
    expect(refused).toBe(true);
  });

  it("a worker is self-service only", async () => {
    authUser.betterAuthId = betterAuthIds.get("worker")!;
    for (const denied of [listMembersAction, listStaffAction, listPlansAction]) {
      let refused = false;
      try {
        await denied({});
      } catch (err) {
        refused = err instanceof ForbiddenError;
      }
      expect(refused).toBe(true);
    }
    // …but the worker's own roster surface works.
    await expect(listLeaveTypesAction()).resolves.toBeDefined();
  });
});
