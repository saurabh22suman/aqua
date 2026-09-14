import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// O-04 (docs/ops-platform-design.md §2–§3) — the config registry:
// fixed resolution order, provenance, append-only writes, validation,
// visibility enforcement and tenant isolation. Hermetic container with
// the real platform catalogue.

type ConfigModule = typeof import("@/db/config");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let config: ConfigModule;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const locA1 = uuidv7();
const locA2 = uuidv7();
const actorId = asUserId(uuidv7());
const platformUserId = uuidv7();
const platformActorId = asUserId(platformUserId);
const RUN = Date.now().toString(36);

const KEY = "attendance.absence_alert_threshold_pct" as const;
const OFFLINE_KEY = "attendance.offline_sync_enabled" as const;

let planId: string;

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

  config = await import("@/db/config");
  admin = new Pool({ connectionString: adminUri });

  const plan = await admin.query<{ id: string }>(
    "select id from plans where key = 'standard'",
  );
  planId = plan.rows[0].id;

  await admin.query(
    `insert into tenants (id, slug, name, status, plan_id, preset_key, preset_version, preset_applied_at)
     values ($1, $2, 'O-04 A', 'active', $4, 'swimming', 1, now()),
            ($3, $5, 'O-04 B', 'active', $4, null, null, null)`,
    [tenantA, `o04-a-${RUN}`, tenantB, planId, `o04-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Main', true),
       ($2, $3, 'Annex', false)`,
    [locA1, locA2, tenantA],
  );
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'O-04 Operator', 'h', 's', 'admin', 'active')`,
    [platformUserId, `o04-${RUN}@platform.test`],
  );
  // audit_log.actor_id references tenant users, so the tenant actor
  // needs a real users row (production ctx.userId always is one).
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actorId,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("O-04 config registry", () => {
  it("returns the default with a `default` source when nothing is set", async () => {
    const resolved = await config.resolveConfig<number>(tenantB, KEY);
    expect(resolved.value).toBe(50);
    expect(resolved.source).toEqual({
      scopeType: "default",
      scopeId: null,
      setBy: null,
      setAt: null,
    });
    expect(resolved.visibility).toBe("owner_edit");
  });

  it("resolves platform → plan → preset → tenant → location in order", async () => {
    const platform = await config.setPlatformConfigValue({
      key: KEY,
      scopeType: "platform",
      value: 40,
      actorId: platformActorId,
      reason: "test",
    });
    expect(platform.ok).toBe(true);
    let resolved = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: locA1,
    });
    expect(resolved.value).toBe(40);
    expect(resolved.source).toMatchObject({
      scopeType: "platform",
      setBy: platformActorId,
    });

    const plan = await config.setPlatformConfigValue({
      key: KEY,
      scopeType: "plan",
      scopeId: planId,
      value: 30,
      actorId: platformActorId,
    });
    expect(plan.ok).toBe(true);
    resolved = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: locA1,
    });
    expect(resolved.value).toBe(30);
    expect(resolved.source.scopeType).toBe("plan");

    const preset = await config.setPlatformConfigValue({
      key: KEY,
      scopeType: "preset",
      scopeId: "swimming@1",
      value: 20,
      actorId: platformActorId,
    });
    expect(preset.ok).toBe(true);
    resolved = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: locA1,
    });
    expect(resolved.value).toBe(20);
    expect(resolved.source).toMatchObject({
      scopeType: "preset",
      scopeId: "swimming@1",
    });

    const tenantWrite = await config.setTenantConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: 10,
      actorId,
    });
    expect(tenantWrite).toEqual({
      ok: true,
      scopeType: "tenant",
      scopeId: tenantA,
    });
    resolved = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: locA1,
    });
    expect(resolved.value).toBe(10);
    expect(resolved.source).toMatchObject({ scopeType: "tenant", setBy: actorId });

    const locationWrite = await config.setTenantConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: 5,
      locationId: locA2,
      actorId,
    });
    expect(locationWrite).toEqual({
      ok: true,
      scopeType: "location",
      scopeId: locA2,
    });
    const atAnnex = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: locA2,
    });
    expect(atAnnex.value).toBe(5);
    expect(atAnnex.source).toMatchObject({
      scopeType: "location",
      scopeId: locA2,
    });
    // The other location still sees the tenant value.
    const atMain = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: locA1,
    });
    expect(atMain.value).toBe(10);
  });

  it("writes append-only, superseding the live row and keeping history", async () => {
    await config.setTenantConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: 12,
      actorId,
      reason: "second write",
    });
    await config.setTenantConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: 13,
      actorId,
      reason: "third write",
    });

    const { rows } = await admin.query<{
      value: unknown;
      reason: string | null;
      superseded_at: Date | null;
    }>(
      `select value, reason, superseded_at from config_values
        where key = $1 and scope_type = 'tenant' and scope_id = $2
        order by set_at`,
      [KEY, tenantA],
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.superseded_at === null)).toHaveLength(1);
    expect(rows[rows.length - 1]).toMatchObject({ value: 13, reason: "third write" });

    const resolved = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: locA1,
    });
    expect(resolved.value).toBe(13);
  });

  it("rejects invalid values and unknown shapes", async () => {
    const tooHigh = await config.setTenantConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: 101,
      actorId,
    });
    expect(tooHigh.ok).toBe(false);

    const wrongType = await config.setTenantConfigValue({
      tenantId: tenantA,
      key: KEY,
      value: "lots",
      actorId,
    });
    expect(wrongType.ok).toBe(false);
  });

  it("fails closed when a tenant tries to write an ops_only key", async () => {
    const result = await config.setTenantConfigValue({
      tenantId: tenantA,
      key: OFFLINE_KEY,
      value: true,
      actorId,
    });
    expect(result.ok).toBe(false);
  });

  it("keeps one tenant's values invisible to another", async () => {
    await config.setTenantConfigValue({
      tenantId: tenantB,
      key: KEY,
      value: 90,
      actorId,
    });
    const b = await config.resolveConfig<number>(tenantB, KEY);
    expect(b.value).toBe(90);
    const a = await config.resolveConfig<number>(tenantA, KEY, {
      locationId: locA1,
    });
    expect(a.value).toBe(13);
  });

  it("exposes every key the code catalogue defines", async () => {
    const { CONFIG_KEYS } = await import("@/db/config-definitions");
    const catalogue = await config.listConfigCatalogue();
    const keys = catalogue.map((row) => row.key).sort();
    // Asserting against the code catalogue rather than a hand-kept list:
    // adding a key should never break this test, only drift should.
    expect(keys).toEqual(Object.keys(CONFIG_KEYS).sort());
  });
});
