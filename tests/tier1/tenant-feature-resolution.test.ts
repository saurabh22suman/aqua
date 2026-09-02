import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import {
  resolveTenantFeatureKeys,
  resolveTenantFeatureSources,
} from "@/db/features";
import { asTenantId, type TenantId } from "@/lib/ids";

// Phase 1.8 — verify resolveTenantFeatureKeys() layers tenant_features
// over plan_features per architecture §7.1.
//
// The plan baseline is two GA features defined in beforeAll.
// Each test inserts tenant_features rows directly via the
// privileged pool (the same way the service does under the hood),
// then asserts on the resolver's output. We don't route through
// upsertTenantFeature here because that path is exhaustively
// covered by tests/tier1/platform-tenant-features.test.ts — running
// the same service concurrently under vitest's per-file parallel
// test execution hits a drizzle/pg prepared-statement interaction
// (empty-string cast for `null` timestamps) that's not specific to
// 1.8 and is better fixed in the prepared-statement layer than
// worked around per-test.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const PREFIX = `resolver-${RUN}`;

const tenants: TenantId[] = [];
let planId: string;
let baselineFeatures: string[] = [];

beforeAll(async () => {
  // Two-feature plan used by every test.
  await admin.query(
    `insert into plans (id, key, name, status, price_paise, currency, is_default, sort_order)
     values (gen_random_uuid(), $1, 'Resolver Test', 'active', null, 'INR', false, 0)`,
    [`${PREFIX}-plan`],
  );
  const plan = await admin.query<{ id: string }>(
    "select id from plans where key = $1",
    [`${PREFIX}-plan`],
  );
  planId = plan.rows[0]!.id;

  baselineFeatures = [`${PREFIX}-a`, `${PREFIX}-b`];
  for (const key of baselineFeatures) {
    await admin.query(
      "insert into features (key, name, category, status) values ($1, 'R', 'core', 'ga') on conflict (key) do nothing",
      [key],
    );
  }
  await admin.query("delete from plan_features where plan_id = $1", [planId]);
  for (const key of baselineFeatures) {
    await admin.query(
      "insert into plan_features (plan_id, feature_key, limits) values ($1, $2, '{}'::jsonb) on conflict do nothing",
      [planId, key],
    );
  }
});

afterAll(async () => {
  if (tenants.length > 0) {
    const ids = tenants.map((t) => t as unknown as string);
    await admin.query(
      "delete from tenant_features where tenant_id = any($1::uuid[])",
      [ids],
    );
    await admin.query("delete from tenants where id = any($1::uuid[])", [ids]);
  }
  await admin.query("delete from plan_features where plan_id = $1", [planId]);
  await admin.query("delete from plans where id = $1", [planId]);
  await admin.query("delete from features where key = any($1::text[])", [
    baselineFeatures,
  ]);
  await admin.end();
});

let counter = 0;
async function seedTenant(): Promise<TenantId> {
  counter += 1;
  const id = asTenantId(uuidv7());
  const slug = `${PREFIX}-t-${counter}`;
  await admin.query(
    "insert into tenants (id, slug, name, status, plan_id) values ($1, $2, 'Resolver Test', 'trial', $3)",
    [id, slug, planId],
  );
  tenants.push(id);
  return id;
}

describe("resolveTenantFeatureKeys (no overrides)", () => {
  it("returns the plan baseline", async () => {
    const tenantId = await seedTenant();
    const result = await resolveTenantFeatureKeys(tenantId);
    expect(result.sort()).toEqual([...baselineFeatures].sort());
  });
});

describe("resolveTenantFeatureKeys (active override)", () => {
  it("adds a feature that isn't in the plan baseline", async () => {
    const tenantId = await seedTenant();
    const newKey = `${PREFIX}-extra`;
    await admin.query(
      "insert into features (key, name, category, status) values ($1, 'Extra', 'core', 'ga') on conflict (key) do nothing",
      [newKey],
    );
    await admin.query(
      "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, $2, true)",
      [tenantId, newKey],
    );
    const result = await resolveTenantFeatureKeys(tenantId);
    expect(result).toContain(newKey);
    expect(result.sort()).toEqual([...baselineFeatures, newKey].sort());
  });

  it("removes a plan-baseline feature when override is disabled", async () => {
    const tenantId = await seedTenant();
    await admin.query(
      "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, $2, false)",
      [tenantId, baselineFeatures[0]!],
    );
    const result = await resolveTenantFeatureKeys(tenantId);
    expect(result).not.toContain(baselineFeatures[0]!);
    expect(result).toContain(baselineFeatures[1]!);
  });
});

describe("resolveTenantFeatureKeys (expired overrides fall through)", () => {
  it("treats an expired enabled=true override as no override", async () => {
    const tenantId = await seedTenant();
    const newKey = `${PREFIX}-expiring`;
    await admin.query(
      "insert into features (key, name, category, status) values ($1, 'Expiring', 'core', 'ga') on conflict (key) do nothing",
      [newKey],
    );
    await admin.query(
      "insert into tenant_features (tenant_id, feature_key, enabled, expires_at) values ($1, $2, true, now() - interval '1 day')",
      [tenantId, newKey],
    );
    const result = await resolveTenantFeatureKeys(tenantId);
    expect(result).not.toContain(newKey);
    expect(result.sort()).toEqual([...baselineFeatures].sort());
  });

  it("treats an expired enabled=false override as no override (feature returns)", async () => {
    const tenantId = await seedTenant();
    await admin.query(
      "insert into tenant_features (tenant_id, feature_key, enabled, expires_at) values ($1, $2, false, now() - interval '1 day')",
      [tenantId, baselineFeatures[0]!],
    );
    const result = await resolveTenantFeatureKeys(tenantId);
    expect(result.sort()).toEqual([...baselineFeatures].sort());
  });
});

describe("resolveTenantFeatureSources", () => {
  it("tags plan-baseline entries with source='plan'", async () => {
    const tenantId = await seedTenant();
    const sources = await resolveTenantFeatureSources(tenantId);
    expect(sources).toHaveLength(baselineFeatures.length);
    for (const s of sources) {
      expect(s.source).toBe("plan");
    }
  });

  it("tags a tenant_override with source='tenant_override'", async () => {
    const tenantId = await seedTenant();
    const newKey = `${PREFIX}-src`;
    await admin.query(
      "insert into features (key, name, category, status) values ($1, 'Source', 'core', 'ga') on conflict (key) do nothing",
      [newKey],
    );
    await admin.query(
      "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, $2, true)",
      [tenantId, newKey],
    );
    const sources = await resolveTenantFeatureSources(tenantId);
    const found = sources.find((s) => s.key === newKey);
    expect(found?.source).toBe("tenant_override");
  });

  it("tags an enabled=false override with source='denied'", async () => {
    const tenantId = await seedTenant();
    await admin.query(
      "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, $2, false)",
      [tenantId, baselineFeatures[0]!],
    );
    const sources = await resolveTenantFeatureSources(tenantId);
    const found = sources.find((s) => s.key === baselineFeatures[0]!);
    expect(found?.source).toBe("denied");
  });
});
