import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { withPlatformAdmin } from "@/db/scope";

// Phase 1.8 — proves the platform_admin_all RLS policy on
// tenant_features (migration 20260902210100). The policy opens
// INSERT/UPDATE/DELETE for the operator's withPlatformAdmin() path;
// tenant users under withTenant() still see only their own rows via
// the existing tenant_isolation policy.

// Two connection flavours in play:
//   - env.DATABASE_URL pool (app_user) — every assertion below
//     routes through this. RLS denies or allows based on what
//     app.platform_admin / app.tenant_id is set to.
//   - env.MIGRATION_DATABASE_URL pool (aqua superuser) — fixture
//     setup and cleanup only; bypasses RLS by being a superuser.

const appPool = new Pool({ connectionString: env.DATABASE_URL });
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const PREFIX = `tf-rls-${RUN}`;
const created: Array<{ id: string; tenantSlug: string }> = [];

beforeAll(async () => {});

afterAll(async () => {
  if (created.length > 0) {
    const ids = created.map((c) => c.id);
    await admin.query(
      "delete from platform_audit_log where tenant_id = any($1::uuid[])",
      [ids],
    );
    await admin.query(
      "delete from tenant_features where tenant_id = any($1::uuid[])",
      [ids],
    );
    await admin.query("delete from tenants where id = any($1::uuid[])", [ids]);
  }
  await appPool.end();
  await admin.end();
});

async function seedTenant(): Promise<string> {
  const id = uuidv7();
  const slug = `${PREFIX}-${id}`;
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, $3, 'trial')",
    [id, slug, "TF RLS Test"],
  );
  created.push({ id, tenantSlug: slug });
  return id;
}

async function seedFeature(): Promise<string> {
  // Use a unique key per run so the test doesn't fight the seed's
  // catalogue; the migration's feature-key FK constraint requires
  // a row in `features` before a tenant_features row can reference
  // it.
  const key = `${PREFIX}-feat`;
  await admin.query(
    "insert into features (key, name, category, status) values ($1, 'Test Feature', 'core', 'ga') on conflict (key) do nothing",
    [key],
  );
  return key;
}

async function attemptTenantFeatureInsert(
  tenantId: string,
  featureKey: string,
  setting: "true" | "false" | "unset",
): Promise<"ok" | "threw"> {
  const client = await appPool.connect();
  try {
    await client.query("set role app_user");
    if (setting === "unset") {
      await client.query(
        "select set_config('app.platform_admin', '', true)",
      );
    } else if (setting === "false") {
      await client.query(
        "select set_config('app.platform_admin', 'false', true)",
      );
    } else {
      await client.query(
        "select set_config('app.platform_admin', 'true', true)",
      );
    }
    await client.query("begin");
    try {
      await client.query(
        "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, $2, true)",
        [tenantId, featureKey],
      );
      await client.query("commit");
      return "ok";
    } catch {
      await client.query("rollback").catch(() => undefined);
      return "threw";
    }
  } finally {
    client.release();
  }
}

describe("platform_admin_all policy on tenant_features", () => {
  it("allows INSERT under withPlatformAdmin()", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    const result = await withPlatformAdmin(async (tx) => {
      await tx.execute(sql`
        insert into tenant_features (tenant_id, feature_key, enabled)
        values (${tenantId}, ${featureKey}, true)
      `);
      return true;
    });
    expect(result).toBe(true);

    const rows = await admin.query<{ enabled: boolean }>(
      "select enabled from tenant_features where tenant_id = $1 and feature_key = $2",
      [tenantId, featureKey],
    );
    expect(rows.rows[0]?.enabled).toBe(true);
  });

  it("denies INSERT on a direct app_user connection with app.platform_admin = 'false'", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    const result = await attemptTenantFeatureInsert(
      tenantId,
      featureKey,
      "false",
    );
    expect(result).toBe("threw");

    const rows = await admin.query<{ count: string }>(
      "select count(*)::text from tenant_features where tenant_id = $1",
      [tenantId],
    );
    expect(Number(rows.rows[0]?.count ?? "0")).toBe(0);
  });

  it("denies INSERT when app.platform_admin is unset", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    const result = await attemptTenantFeatureInsert(
      tenantId,
      featureKey,
      "unset",
    );
    expect(result).toBe("threw");
  });

  it("allows UPDATE and DELETE under withPlatformAdmin()", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();

    await withPlatformAdmin(async (tx) => {
      await tx.execute(sql`
        insert into tenant_features (tenant_id, feature_key, enabled)
        values (${tenantId}, ${featureKey}, true)
      `);
    });

    const updated = await withPlatformAdmin(async (tx) => {
      await tx.execute(sql`
        update tenant_features set enabled = false
        where tenant_id = ${tenantId} and feature_key = ${featureKey}
      `);
      return true;
    });
    expect(updated).toBe(true);
    const afterUpdate = await admin.query<{ enabled: boolean }>(
      "select enabled from tenant_features where tenant_id = $1 and feature_key = $2",
      [tenantId, featureKey],
    );
    expect(afterUpdate.rows[0]?.enabled).toBe(false);

    const deleted = await withPlatformAdmin(async (tx) => {
      await tx.execute(sql`
        delete from tenant_features
        where tenant_id = ${tenantId} and feature_key = ${featureKey}
      `);
      return true;
    });
    expect(deleted).toBe(true);
    const afterDelete = await admin.query<{ count: string }>(
      "select count(*)::text from tenant_features where tenant_id = $1",
      [tenantId],
    );
    expect(Number(afterDelete.rows[0]?.count ?? "0")).toBe(0);
  });
});
