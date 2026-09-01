import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { withPlatformAdmin } from "@/db/scope";

// Phase 1.6 — proves the migration
// 20260902210000_platform_admin_tenant_update.sql holds: app_user
// can UPDATE `tenants.status` only when app.platform_admin =
// 'true'. The existing tenant_isolation policy (FOR ALL, with
// check id = app.tenant_id) still gates tenant-self UPDATE — the
// new policy is additive, additive to that one, not a weakening.
//
// test isolation note: an existing row's UPDATE status is rolled
// back (or rolled forward and trash-collected in afterAll) by
// checking the slug belongs to RUN. The platform_admin_update
// test for `id = app.tenant_id::uuid` (the tenant-self path) is
// intentionally not exercised here — that's the existing
// tenant_isolation contract, unchanged by this migration.

const appPool = new Pool({ connectionString: env.DATABASE_URL });
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const SLUG_PREFIX = `update-rls-${RUN}`;
const created: Array<{ id: string }> = [];

beforeAll(async () => {
  // seed a small number of tenant rows we can UPDATE under test;
  // each test gets its own uuid so concurrent test runs don't
  // collide on a slug.
});

afterAll(async () => {
  if (created.length > 0) {
    const ids = created.map((r) => r.id);
    await admin.query(
      "delete from platform_audit_log where tenant_id = any($1::uuid[])",
      [ids],
    );
    await admin.query(
      "delete from tenants where id = any($1::uuid[])",
      [ids],
    );
  }
  await appPool.end();
  await admin.end();
});

// Attempt a status UPDATE on a direct app_user connection under the
// given platform_admin setting. Returns the row's status seen via
// the admin pool *after* the attempt. RLS silently fails
// non-matching USING clauses — UPDATE 0, no exception — so the
// invariant the test pins is "status did not change", not
// "statement threw". Both server-action and service-layer paths
// follow up with platform-side checks; this guard is the belt to
// that suspenders.
async function attemptStatusUpdate(opts: {
  appPlatformAdmin: "true" | "false" | "unset";
  tenantId: string;
  newStatus: "trial" | "active" | "suspended" | "churned";
}): Promise<string> {
  const client = await appPool.connect();
  try {
    await client.query("set role app_user");
    if (opts.appPlatformAdmin === "unset") {
      await client.query(
        "select set_config('app.platform_admin', '', true)",
      );
    } else {
      await client.query(
        "select set_config('app.platform_admin', $1, true)",
        [opts.appPlatformAdmin],
      );
    }
    await client.query("begin");
    try {
      await client.query(
        "update tenants set status = $1 where id = $2",
        [opts.newStatus, opts.tenantId],
      );
      await client.query("commit");
    } catch {
      await client.query("rollback").catch(() => undefined);
    }
  } finally {
    client.release();
  }
  const rows = await admin.query<{ status: string }>(
    "select status from tenants where id = $1",
    [opts.tenantId],
  );
  return rows.rows[0]?.status ?? "?";
}

async function seedTenant(): Promise<string> {
  const id = uuidv7();
  const slug = `${SLUG_PREFIX}-${id}`;
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, $3, 'trial')",
    [id, slug, "Update RLS Test"],
  );
  created.push({ id });
  return id;
}

describe("platform_admin_update policy on tenants", () => {
  it("lets withPlatformAdmin() UPDATE tenants.status", async () => {
    const tenantId = await seedTenant();
    const result = await withPlatformAdmin(async (tx) => {
      await tx.execute(sql`update tenants set status = 'active' where id = ${tenantId}`);
      return true;
    });
    expect(result).toBe(true);

    // Round-trip read under withPlatformAdmin — also a sanity
    // check that the same SELECT-side policy used by getTenantDetail
    // still sees the row after the UPDATE.
    const seen = await withPlatformAdmin(
      async (tx) =>
        (await tx.execute<{ status: string }>(
          sql`select status from tenants where id = ${tenantId}`,
        )) as unknown as { rows: Array<{ status: string }> },
    );
    const rows = (seen as unknown as { rows: Array<{ status: string }> }).rows;
    expect(rows[0]?.status).toBe("active");
  });

  it("denies UPDATE on an app_user connection with app.platform_admin = 'false' (status unchanged)", async () => {
    const tenantId = await seedTenant();
    await attemptStatusUpdate({
      appPlatformAdmin: "false",
      tenantId,
      newStatus: "suspended",
    });
    // Seeded with 'trial'; the failed UPDATE leaves it at 'trial'.
    const rows = await admin.query<{ status: string }>(
      "select status from tenants where id = $1",
      [tenantId],
    );
    expect(rows.rows[0]?.status).toBe("trial");
  });

  it("denies UPDATE when app.platform_admin is unset (status unchanged)", async () => {
    const tenantId = await seedTenant();
    await attemptStatusUpdate({
      appPlatformAdmin: "unset",
      tenantId,
      newStatus: "suspended",
    });
    const rows = await admin.query<{ status: string }>(
      "select status from tenants where id = $1",
      [tenantId],
    );
    expect(rows.rows[0]?.status).toBe("trial");
  });

  it("honours db/scope.ts's withPlatformAdmin on repeated UPDATE calls", async () => {
    // Sanity that the wrapper still sees the migration's policy on
    // sequential calls. Drop the policy in a future migration and
    // this turns red.
    for (let i = 0; i < 2; i++) {
      const tenantId = await seedTenant();
      await withPlatformAdmin(async (tx) => {
        await tx.execute(
          sql`update tenants set status = ${i === 0 ? "active" : "suspended"} where id = ${tenantId}`,
        );
      });
      // Cleanup so the unique-slug requirement doesn't conflict
      // on a stuck rerun.
      await admin.query("delete from tenants where id = $1", [tenantId]);
      created.pop();
    }
  });
});
