import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { seedPlatformCatalogue } from "@/db/seed-platform";
import { resolveTenantFeatureKeys } from "@/db/features";

// tenants has FORCE row level security, so setup/teardown rows must be
// inserted through the privileged migration pool, never the app pool.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const PILOT_KEY = `pilot-${RUN}`;
const PLATFORM_TABLES = [
  "plans",
  "features",
  "plan_features",
  "presets",
  "permissions",
];

let tenantId = "";
let pilotPlanId = "";

async function gaFeatureKeys(): Promise<string[]> {
  const { rows } = await admin.query<{ key: string }>(
    "select key from features where status = 'ga' order by key",
  );
  return rows.map((r) => r.key);
}

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  if (pilotPlanId) {
    await admin.query("delete from plans where id = $1", [pilotPlanId]);
  }
  await admin.end();
});

describe("platform catalogue and plan-baseline entitlements", () => {
  it("seedPlatformCatalogue is idempotent and seeds exactly one default plan", async () => {
    await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);
    await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);

    const defaults = await admin.query<{ key: string; price_paise: string | null }>(
      "select key, price_paise from plans where is_default = true",
    );
    expect(defaults.rows).toHaveLength(1);
    expect(defaults.rows[0].key).toBe("standard");
    expect(defaults.rows[0].price_paise).toBeNull();

    const featureCount = await admin.query<{ n: number }>(
      "select count(*)::int as n from features",
    );
    expect(featureCount.rows[0].n).toBe(13);

    const planned = (
      await admin.query<{ feature_key: string }>(
        `select feature_key from plan_features
         where plan_id = (select id from plans where key = 'standard')
         order by feature_key`,
      )
    ).rows.map((r) => r.feature_key);
    expect(planned).toEqual(await gaFeatureKeys());

    const nonGaPlanned = await admin.query(
      `select f.key from features f
       join plan_features pf on pf.feature_key = f.key
       where f.status <> 'ga'
         and pf.plan_id = (select id from plans where key = 'standard')`,
    );
    expect(nonGaPlanned.rows).toHaveLength(0);
  });

  it("a tenant on the standard plan resolves features through the plan baseline alone", async () => {
    const standard = await admin.query<{ id: string }>(
      "select id from plans where key = 'standard'",
    );
    expect(standard.rows).toHaveLength(1);

    tenantId = uuidv7();
    await admin.query(
      "insert into tenants (id, slug, name, plan_id) values ($1, $2, 'F-01 baseline', $3)",
      [tenantId, `f01-${RUN}`, standard.rows[0].id],
    );

    const resolved = await resolveTenantFeatureKeys(tenantId);
    expect(resolved).toEqual(await gaFeatureKeys());
  });

  it("the pricing decision lands with data changes only — zero schema edits", async () => {
    const before = (
      await admin.query<{ n: number }>(
        "select count(*)::int as n from _migrations",
      )
    ).rows[0].n;

    pilotPlanId = uuidv7();
    await admin.query(
      `insert into plans (id, key, name, status, price_paise, currency, is_default, sort_order)
       values ($1, $2, 'Pilot', 'active', null, 'INR', false, 1)`,
      [pilotPlanId, PILOT_KEY],
    );
    await admin.query(
      "insert into plan_features (plan_id, feature_key) values ($1, 'attendance'), ($1, 'members')",
      [pilotPlanId],
    );
    await admin.query("update tenants set plan_id = $1 where id = $2", [
      pilotPlanId,
      tenantId,
    ]);

    const resolved = await resolveTenantFeatureKeys(tenantId);
    expect(resolved).toEqual(["attendance", "members"]);

    const after = (
      await admin.query<{ n: number }>(
        "select count(*)::int as n from _migrations",
      )
    ).rows[0].n;
    // This count assertion IS the "zero schema edits" proof: a second plan
    // and a tenant repoint landed through insert/update alone — no new
    // migration, no DDL.
    expect(after).toBe(before);
  });

  it("the five platform tables are RLS-free by design", async () => {
    const { rows } = await admin.query<{
      relname: string;
      rls: boolean;
      forced: boolean;
    }>(
      `select c.relname,
              c.relrowsecurity       as rls,
              c.relforcerowsecurity  as forced
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1)`,
      [PLATFORM_TABLES],
    );

    expect(rows.map((r) => r.relname).sort()).toEqual(
      [...PLATFORM_TABLES].sort(),
    );
    for (const row of rows) {
      expect(row.rls, `${row.relname} must not have RLS`).toBe(false);
      expect(row.forced, `${row.relname} must not force RLS`).toBe(false);
    }
  });
});
