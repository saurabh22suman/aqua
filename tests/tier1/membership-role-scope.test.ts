import { afterAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { seedRoleTemplates } from "@/lib/services/roles";
import { requireDefaultCtx } from "@/lib/auth/context";

// requireDefaultCtx needs a session; stub only the framework edges
// (better-auth session + next/headers). The database path it exercises —
// resolveDefaultMembership + resolveLocationIds — stays real.
const { authUser } = vi.hoisted(() => ({ authUser: { betterAuthId: "" } }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: authUser.betterAuthId } }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

// tenants/roles have FORCE row level security, so fixtures are created
// through the privileged migration pool, never the app pool.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const tenantA = uuidv7();
const tenantB = uuidv7();

async function expectPgError(
  promise: Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await promise;
    return {};
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  }
}

const cleanupUserIds: string[] = [];
const cleanupMembershipIds: string[] = [];
const cleanupLocationIds: string[] = [];

afterAll(async () => {
  await admin.query("delete from tenant_memberships where id = any($1)", [
    cleanupMembershipIds,
  ]);
  await admin.query("delete from locations where id = any($1)", [
    cleanupLocationIds,
  ]);
  await admin.query("delete from users where id = any($1)", [
    cleanupUserIds,
  ]);
  await admin.query("delete from roles where tenant_id = any($1)", [
    [tenantA, tenantB],
  ]);
  await admin.query("delete from tenants where id = any($1)", [
    [tenantA, tenantB],
  ]);
  await admin.end();
});

describe("F-03a: a membership's role is always the same tenant's role", () => {
  it("a membership cannot reference another tenant's role", async () => {
    await admin.query(
      "insert into tenants (id, slug, name) values ($1, $2, 'MRS A'), ($3, $4, 'MRS B')",
      [tenantA, `mrs-a-${RUN}`, tenantB, `mrs-b-${RUN}`],
    );
    await seedRoleTemplates(tenantA);
    await seedRoleTemplates(tenantB);

    // Privileged pool on purpose: RLS is out of the picture — the composite
    // FK must be what rejects the cross-tenant reference, and it must
    // reject with a foreign-key violation (23503), not merely any throw.
    const phone = `f03a-xrole-${RUN}`;
    const uid = uuidv7();
    await admin.query("insert into users (id, phone) values ($1, $2)", [
      uid,
      phone,
    ]);
    cleanupUserIds.push(uid);

    const bRoleId = (
      await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1 and key = 'coach'",
        [tenantB],
      )
    ).rows[0].id;

    const err = await expectPgError(
      admin.query(
        "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1, $2, $3, $4, 'active')",
        [uuidv7(), tenantA, uid, bRoleId],
      ),
    );
    expect(err.code).toBe("23503");
    expect(err.constraint).toBe("tenant_memberships_role_tenant_fkey");
  });

  it("a location-scoped membership does not receive every location", async () => {
    // requireDefaultCtx needs headers() from the request scope; with
    // next/headers and the auth server stubbed at the top of this file it
    // runs end to end here, exercising the real resolveDefaultMembership +
    // resolveLocationIds database path.
    const phone = `f03a-scope-${RUN}`;
    const betterAuthId = `f03a-ba-${RUN}`;
    const uid = uuidv7();
    await admin.query(
      "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
      [uid, phone, betterAuthId],
    );
    cleanupUserIds.push(uid);

    const ownerRole = (
      await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1 and key = 'owner'",
        [tenantA],
      )
    ).rows[0].id;

    const locScoped = uuidv7();
    const locOther = uuidv7();
    await admin.query(
      "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Scoped Hall', true), ($3, $2, 'Other Hall', false)",
      [locScoped, tenantA, locOther],
    );
    cleanupLocationIds.push(locScoped, locOther);

    const mid = uuidv7();
    await admin.query(
      "insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status) values ($1, $2, $3, $4, false, 'active')",
      [mid, tenantA, uid, ownerRole],
    );
    cleanupMembershipIds.push(mid);
    await admin.query(
      "insert into membership_locations (id, tenant_id, membership_id, location_id) values ($1, $2, $3, $4)",
      [uuidv7(), tenantA, mid, locScoped],
    );

    authUser.betterAuthId = betterAuthId;
    const ctx = await requireDefaultCtx();

    expect(ctx.membershipId).toBe(mid);
    expect(ctx.allLocations).toBe(false);
    expect(ctx.locationIds).toEqual([locScoped]);
    // ctx.userId must be the platform users.id (uid), not
    // session.user.id (betterAuthId) -- a different id space entirely.
    // Found while adding coach-assignment scoping (docs/architecture.md
    // §9.2): comparing session.user.id against a stored users.id never
    // matched for a real logged-in user. resolveCtxFor (the other
    // Ctx-building path) already returned the resolved platform id;
    // requireDefaultCtx silently didn't.
    expect(ctx.userId).toBe(uid);
    expect(ctx.userId).not.toBe(betterAuthId);
  });
});
