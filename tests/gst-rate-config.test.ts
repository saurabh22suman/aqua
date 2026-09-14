import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";
import {
  formatBasisPointsAsPercent,
  parsePercentToBasisPoints,
} from "@/lib/tax";

// Step B of the 2026-09-14 reshuffle — the GST rate as configuration,
// resolved platform -> tenant -> facility -> activity. Plan prices are
// GST-exclusive; this rate is what invoices will apply.

type ConfigAdmin = typeof import("@/db/config-admin");
type Config = typeof import("@/db/config");
type Tax = typeof import("@/lib/services/tax");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let configAdmin: ConfigAdmin;
let config: Config;
let tax: Tax;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const platformUserId = asUserId(uuidv7());
const loc1 = uuidv7();
const loc2 = uuidv7();
const act1 = uuidv7();
const act2 = uuidv7();
const act3 = uuidv7();
const RUN = Date.now().toString(36);

const KEY = "billing.gst_rate_bp" as const;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(adminUri);

  configAdmin = await import("@/db/config-admin");
  config = await import("@/db/config");
  tax = await import("@/lib/services/tax");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'GST A', 'active'), ($3, $4, 'GST B', 'active')",
    [tenantA, `gst-a-${RUN}`, tenantB, `gst-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Splashh', true),
       ($2, $3, 'Annex', false)`,
    [loc1, loc2, tenantA],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values
       ($1, $4, $5, 'Swimming pool', 'pool', 24),
       ($2, $4, $5, 'Café counter', 'counter', 1),
       ($3, $4, $6, 'Badminton court', 'court', 4)`,
    [act1, act2, act3, tenantA, loc1, loc2],
  );
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'GST Operator', 'h', 's', 'admin', 'active')`,
    [platformUserId, `gst-${RUN}@platform.test`],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("percent <-> basis points", () => {
  it("parses percents strictly", () => {
    expect(parsePercentToBasisPoints("18")).toBe(1800);
    expect(parsePercentToBasisPoints("2.5")).toBe(250);
    expect(parsePercentToBasisPoints("0.05")).toBe(5);
    expect(parsePercentToBasisPoints("5%")).toBe(500);
    expect(parsePercentToBasisPoints("0")).toBe(0);
    expect(parsePercentToBasisPoints("100")).toBe(10000);
  });

  it("rejects malformed or out-of-range percents", () => {
    expect(parsePercentToBasisPoints("18.555")).toBeNull();
    expect(parsePercentToBasisPoints("120")).toBeNull();
    expect(parsePercentToBasisPoints("abc")).toBeNull();
    expect(parsePercentToBasisPoints("-1")).toBeNull();
    expect(parsePercentToBasisPoints("")).toBeNull();
  });

  it("formats basis points back to percent", () => {
    expect(formatBasisPointsAsPercent(1800)).toBe("18%");
    expect(formatBasisPointsAsPercent(250)).toBe("2.5%");
    expect(formatBasisPointsAsPercent(5)).toBe("0.05%");
    expect(formatBasisPointsAsPercent(0)).toBe("0%");
  });
});

describe("GST resolution order", () => {
  it("falls back to the platform default of 18%", async () => {
    const resolved = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: loc1,
      activityId: act1,
    });
    expect(resolved.value).toBe(1800);
    expect(resolved.source.scopeType).toBe("default");
  });

  it("walks tenant -> facility -> activity, most specific winning", async () => {
    const tenantSet = await configAdmin.setPlatformScopedConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: 500,
      scope: { scopeType: "tenant" },
      actorId: platformUserId,
    });
    expect(tenantSet.ok).toBe(true);

    // Everything inherits the tenant default...
    let resolved = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: loc1,
      activityId: act1,
    });
    expect(resolved.value).toBe(500);
    expect(resolved.source.scopeType).toBe("tenant");
    // ...including the other site and activity.
    expect(
      (
        await config.resolveConfig<number>(tenantA, KEY, {
          locationId: loc2,
          activityId: act3,
        })
      ).value,
    ).toBe(500);

    // Facility override.
    const locationSet = await configAdmin.setPlatformScopedConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: 1200,
      scope: { scopeType: "location", scopeId: loc1 },
      actorId: platformUserId,
    });
    expect(locationSet.ok).toBe(true);
    resolved = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: loc1,
      activityId: act2,
    });
    expect(resolved.value).toBe(1200);
    expect(resolved.source.scopeType).toBe("location");
    expect(resolved.source.scopeId).toBe(loc1);

    // Activity override (café could sit at 5% here).
    const activitySet = await configAdmin.setPlatformScopedConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: 250,
      scope: { scopeType: "activity", scopeId: act1 },
      actorId: platformUserId,
    });
    expect(activitySet.ok).toBe(true);
    resolved = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: loc1,
      activityId: act1,
    });
    expect(resolved.value).toBe(250);
    expect(resolved.source).toMatchObject({
      scopeType: "activity",
      scopeId: act1,
    });

    // Sibling activity at the same facility still inherits the facility.
    expect(
      (
        await config.resolveConfig<number>(tenantA, KEY, {
          locationId: loc1,
          activityId: act2,
        })
      ).value,
    ).toBe(1200);
  });

  it("rejects invalid rates at the boundary", async () => {
    const tooHigh = await configAdmin.setPlatformScopedConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: 10001,
      scope: { scopeType: "tenant" },
      actorId: platformUserId,
    });
    expect(tooHigh.ok).toBe(false);

    const wrongType = await configAdmin.setPlatformScopedConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: "18",
      scope: { scopeType: "tenant" },
      actorId: platformUserId,
    });
    expect(wrongType.ok).toBe(false);
  });

  it("shows every level in the ops read model", async () => {
    const result = await tax.getTenantTaxConfig(tenantA);
    expect(result.tenant.rateBp).toBe(500);
    expect(result.locations.find((l) => l.scopeId === loc1)?.rateBp).toBe(1200);
    expect(result.locations.find((l) => l.scopeId === loc2)?.rateBp).toBe(500);
    expect(result.activities.find((a) => a.scopeId === act1)?.rateBp).toBe(250);
    expect(result.activities.find((a) => a.scopeId === act2)?.rateBp).toBe(1200);
    expect(result.activities.find((a) => a.scopeId === act3)?.rateBp).toBe(500);
    expect(result.activities.find((a) => a.scopeId === act1)?.label).toContain(
      "Swimming pool",
    );
  });

  it("audits every rate write", async () => {
    const audit = await admin.query<{ detail: Record<string, unknown> }>(
      "select detail from platform_audit_log where action = 'config.set' and detail ->> 'key' = $1",
      [KEY],
    );
    expect(audit.rows).toHaveLength(3);
    const scopes = audit.rows.map((row) => row.detail.scopeType).sort();
    expect(scopes).toEqual(["activity", "location", "tenant"]);
  });

  it("keeps tenant-scoped values invisible to other tenants", async () => {
    const { withTenant } = await import("@/db/tenant");
    const { configValues } = await import("@/db/schema/config");
    const { inArray } = await import("drizzle-orm");

    const rowsForB = await withTenant(tenantB, (tx) =>
      tx
        .select()
        .from(configValues)
        .where(inArray(configValues.scopeType, ["tenant", "location", "activity"])),
    );
    expect(rowsForB).toHaveLength(0);

    const rowsForA = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(configValues)
        .where(inArray(configValues.scopeType, ["tenant", "location", "activity"])),
    );
    expect(rowsForA.length).toBeGreaterThanOrEqual(3);
  });
});
