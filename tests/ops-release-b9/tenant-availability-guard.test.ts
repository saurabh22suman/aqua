import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedRoleTemplates } from "@/lib/services/roles";
import { privilegedFixturePool } from "../db/privileged-fixture";
import {
  resolveDefaultMembership,
  resolveHomePath,
  resolveSessionForLogin,
  resolveTenantAccessBySlug,
} from "@/db/platform";
import {
  NotFoundError,
  requireDefaultCtx,
  resolveCtxFor,
} from "@/lib/auth/context";
import { listMembersAction } from "@/lib/actions/people";
import { asTenantId } from "@/lib/ids";

// P1 RELEASE BLOCKER (coordinator-confirmed, d692fd3): an Ops
// `tenant.suspend` / `tenant.churn` transition did NOT revoke access
// for the tenant's existing sessions.
//
// Evidence (.playwright-mcp/coordinator/suspension-results.json):
//   GET /owner  -> HTTP 200, tenant heading visible, "Collect payment"
//   visible, in BOTH the suspended and the churned state.
//
// Root cause: db/platform.ts's request-time resolvers —
// resolveDefaultMembership, resolveTenantAccessBySlug, resolveHomePath —
// filter on the MEMBERSHIP's status but never on the TENANT's status,
// and lib/auth/context.ts builds every request context from them. The
// login-time resolver (resolveSessionForLogin) DOES filter, so the
// login form said "your club is paused" while the already-signed-in
// session kept working. A login gate is not a revocation.
//
// This file is the regression. It is deliberately written against the
// request-time resolution path (requireDefaultCtx -> resolveDefaultMembership
// / resolveCtxFor -> resolveTenantAccessBySlug), because that is the
// path BOTH the page layouts and every tenant Server Action use.
//
// The better-auth session and next/headers are stubbed at the framework
// edge only (the pattern in tests/tier1/membership-role-scope.test.ts);
// every database decision under test stays real.

// The stubbed identity is swapped per test case, so the better-auth id
// the mocked session resolves to is mutable.
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

// tenants/roles/tenant_memberships carry FORCE row level security, so
// fixtures are written through the privileged migration pool.
//
// The pool comes from the sanctioned fixture helper in tests/db/ rather
// than being built here: tests/tier1/no-superuser-on-request-path.test.ts
// requires the privileged credential to be named in exactly one place,
// and a test file that names it has to be allowlisted by path. Importing
// the helper keeps this file out of that allowlist without weakening it.
const admin = privilegedFixturePool;

const RUN = Date.now().toString(36);

const tenantActive = asTenantId(uuidv7());
const tenantTrial = asTenantId(uuidv7());
const tenantSuspended = asTenantId(uuidv7());
const tenantChurned = asTenantId(uuidv7());

const slugActive = `avail-active-${RUN}`;
const slugTrial = `avail-trial-${RUN}`;
const slugSuspended = `avail-suspended-${RUN}`;
const slugChurned = `avail-churned-${RUN}`;

const allTenants = [tenantActive, tenantTrial, tenantSuspended, tenantChurned];

// One better-auth id per persona; the platform `users` row carries it.
const baIds = {
  active: `avail-ba-active-${RUN}`,
  trial: `avail-ba-trial-${RUN}`,
  suspended: `avail-ba-suspended-${RUN}`,
  churned: `avail-ba-churned-${RUN}`,
  multi: `avail-ba-multi-${RUN}`,
};

const cleanupUsers: string[] = [];
const cleanupMemberships: string[] = [];

async function seedUser(betterAuthId: string): Promise<string> {
  const userId = uuidv7();
  await admin.query(
    "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
    [userId, `avail-${betterAuthId}`, betterAuthId],
  );
  cleanupUsers.push(userId);
  return userId;
}

async function addMembership(
  userId: string,
  tenantId: string,
  roleKey = "owner",
): Promise<void> {
  const role = (
    await admin.query<{ id: string }>(
      "select id from roles where tenant_id = $1 and key = $2",
      [tenantId, roleKey],
    )
  ).rows[0];
  if (!role) throw new Error(`missing role ${roleKey} for tenant ${tenantId}`);
  const membershipId = uuidv7();
  await admin.query(
    "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1, $2, $3, $4, 'active')",
    [membershipId, tenantId, userId, role.id],
  );
  cleanupMemberships.push(membershipId);
}

async function seedUserWithMembership(
  betterAuthId: string,
  tenantId: string,
  roleKey = "owner",
): Promise<string> {
  const userId = await seedUser(betterAuthId);
  await addMembership(userId, tenantId, roleKey);
  return userId;
}

async function setTenantStatus(tenantId: string, status: string): Promise<void> {
  await admin.query("update tenants set status = $2 where id = $1", [
    tenantId,
    status,
  ]);
}

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, status) values
     ($1, $2, 'Availability Active', 'active'),
     ($3, $4, 'Availability Trial', 'trial'),
     ($5, $6, 'Availability Suspended', 'suspended'),
     ($7, $8, 'Availability Churned', 'churned')`,
    [
      tenantActive,
      slugActive,
      tenantTrial,
      slugTrial,
      tenantSuspended,
      slugSuspended,
      tenantChurned,
      slugChurned,
    ],
  );
  for (const tenantId of allTenants) {
    await seedRoleTemplates(tenantId);
  }

  await seedUserWithMembership(baIds.active, tenantActive);
  await seedUserWithMembership(baIds.trial, tenantTrial);
  await seedUserWithMembership(baIds.suspended, tenantSuspended);
  await seedUserWithMembership(baIds.churned, tenantChurned);

  // Multi-tenant persona: an active membership AND a suspended one.
  // The SUSPENDED tenant's owner role carries the lower homeOrdinal, so
  // before the fix the resolver picked the suspended tenant (the leak)
  // and after the fix it must pick the operational one. The ordering is
  // data (roles.home_ordinal), never a role-key branch.
  const multiUserId = await seedUser(baIds.multi);
  await addMembership(multiUserId, tenantSuspended);
  await addMembership(multiUserId, tenantActive);
  await admin.query(
    "update roles set home_ordinal = 5 where tenant_id = $1 and key = 'owner'",
    [tenantActive],
  );
});

afterAll(async () => {
  await admin.query("delete from tenant_memberships where id = any($1)", [
    cleanupMemberships,
  ]);
  await admin.query("delete from role_permissions where tenant_id = any($1)", [
    allTenants,
  ]);
  await admin.query("delete from roles where tenant_id = any($1)", [
    allTenants,
  ]);
  await admin.query("delete from users where id = any($1)", [cleanupUsers]);
  await admin.query("delete from tenants where id = any($1)", [allTenants]);
});

function signInAs(betterAuthId: string): void {
  authUser.betterAuthId = betterAuthId;
}

describe("P1: a suspended/churned tenant must not keep serving existing sessions", () => {
  // ---- NEGATIVE: suspended -------------------------------------------

  it("requireDefaultCtx refuses when the caller's only tenant is suspended", async () => {
    signInAs(baIds.suspended);
    await expect(requireDefaultCtx()).rejects.toThrow(NotFoundError);
  });

  it("requireDefaultCtx refuses when the caller's only tenant is churned", async () => {
    signInAs(baIds.churned);
    await expect(requireDefaultCtx()).rejects.toThrow(NotFoundError);
  });

  it("resolveDefaultMembership returns nothing for a suspended tenant", async () => {
    signInAs(baIds.suspended);
    expect(await resolveDefaultMembership(baIds.suspended)).toBeNull();
  });

  it("resolveDefaultMembership returns nothing for a churned tenant", async () => {
    signInAs(baIds.churned);
    expect(await resolveDefaultMembership(baIds.churned)).toBeNull();
  });

  it("resolveTenantAccessBySlug refuses a suspended tenant's slug", async () => {
    signInAs(baIds.suspended);
    expect(await resolveTenantAccessBySlug(baIds.suspended, slugSuspended)).toBeNull();
  });

  it("resolveTenantAccessBySlug refuses a churned tenant's slug", async () => {
    signInAs(baIds.churned);
    expect(await resolveTenantAccessBySlug(baIds.churned, slugChurned)).toBeNull();
  });

  it("resolveCtxFor refuses a suspended tenant's slug", async () => {
    signInAs(baIds.suspended);
    await expect(
      resolveCtxFor(baIds.suspended, slugSuspended),
    ).rejects.toThrow(NotFoundError);
  });

  it("resolveHomePath returns nothing for a suspended tenant", async () => {
    signInAs(baIds.suspended);
    expect(await resolveHomePath(baIds.suspended)).toBeNull();
  });

  it("resolveHomePath returns nothing for a churned tenant", async () => {
    signInAs(baIds.churned);
    expect(await resolveHomePath(baIds.churned)).toBeNull();
  });

  // A representative Server Action must be refused too — the layout
  // redirect alone would not be an authorization control (the repo rule:
  // "layouts are for UI only; every page and every server action
  // authorizes itself").
  it("a representative tenant Server Action is refused for a suspended tenant", async () => {
    signInAs(baIds.suspended);
    await expect(listMembersAction({})).rejects.toThrow(NotFoundError);
  });

  it("a representative tenant Server Action is refused for a churned tenant", async () => {
    signInAs(baIds.churned);
    await expect(listMembersAction({})).rejects.toThrow(NotFoundError);
  });

  // ---- MULTI-TENANT: no cross-scope fallback --------------------------

  it("a multi-tenant member is never resolved into a suspended tenant", async () => {
    signInAs(baIds.multi);
    const membership = await resolveDefaultMembership(baIds.multi);
    expect(membership?.tenantId).not.toBe(tenantSuspended);
    // The existing multitenant contract (resolveSessionForLogin) picks the
    // lowest homeOrdinal among OPERATIONAL tenants. The suspended tenant's
    // role carries the lower ordinal, so before the fix the resolver
    // returned the suspended tenant; after the fix it returns the
    // operational one. Documented, not incidental.
    expect(membership?.tenantId).toBe(tenantActive);
  });

  it("a multi-tenant member still reaches an operational tenant", async () => {
    signInAs(baIds.multi);
    const ctx = await requireDefaultCtx();
    expect(ctx.tenantId).toBe(tenantActive);
  });

  it("a multi-tenant member is refused for the suspended tenant's own slug", async () => {
    signInAs(baIds.multi);
    await expect(
      resolveCtxFor(baIds.multi, slugSuspended),
    ).rejects.toThrow(NotFoundError);
  });

  // ---- POSITIVE CONTROLS: active / trial still work -------------------

  it("an active tenant still resolves a context (positive control)", async () => {
    signInAs(baIds.active);
    const ctx = await requireDefaultCtx();
    expect(ctx.tenantId).toBe(tenantActive);
    expect(ctx.roleKey).toBe("owner");
  });

  it("an active tenant still resolves its slug (positive control)", async () => {
    signInAs(baIds.active);
    const access = await resolveTenantAccessBySlug(baIds.active, slugActive);
    expect(access?.tenantId).toBe(tenantActive);
    const ctx = await resolveCtxFor(baIds.active, slugActive);
    expect(ctx.tenantId).toBe(tenantActive);
  });

  it("a trial tenant still resolves a context (positive control)", async () => {
    signInAs(baIds.trial);
    const ctx = await requireDefaultCtx();
    expect(ctx.tenantId).toBe(tenantTrial);
    expect(ctx.roleKey).toBe("owner");
  });

  it("a representative tenant Server Action still works for an active tenant", async () => {
    signInAs(baIds.active);
    await expect(listMembersAction({})).resolves.toEqual([]);
  });

  it("resolveHomePath still resolves for an active tenant (positive control)", async () => {
    signInAs(baIds.active);
    expect(await resolveHomePath(baIds.active)).toBe("/owner");
  });

  // ---- LOGIN FEEDBACK IS PRESERVED ------------------------------------

  it("the login-time resolver still names the paused club (useful feedback preserved)", async () => {
    signInAs(baIds.suspended);
    const resolution = await resolveSessionForLogin(baIds.suspended);
    expect(resolution).toEqual({ kind: "suspended", tenantSlugs: [slugSuspended] });
  });

  // ---- REACTIVATION IS SAFE ------------------------------------------

  it("reactivating a suspended tenant restores access without touching the session", async () => {
    signInAs(baIds.suspended);
    await expect(requireDefaultCtx()).rejects.toThrow(NotFoundError);
    try {
      await setTenantStatus(tenantSuspended, "active");
      const ctx = await requireDefaultCtx();
      expect(ctx.tenantId).toBe(tenantSuspended);
    } finally {
      await setTenantStatus(tenantSuspended, "suspended");
    }
  });
});
