import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// O-06 (docs/ops-platform-design.md §6) — the effective-configuration
// viewer's data. Proves resolved values carry provenance, location
// overrides surface, entitlements carry their source, the permission
// matrix is real, and no member PII can appear in the payload.

type ViewModule = typeof import("@/db/ops-configuration-view");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let getEffectiveConfiguration: ViewModule["getEffectiveConfiguration"];

const tenantId = asTenantId(uuidv7());
const locMain = uuidv7();
const locAnnex = uuidv7();
const actorId = asUserId(uuidv7());
const platformUserId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const RUN = Date.now().toString(36);

const KEY = "attendance.absence_alert_threshold_pct" as const;

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

  const view = await import("@/db/ops-configuration-view");
  getEffectiveConfiguration = view.getEffectiveConfiguration;
  const config = await import("@/db/config");
  const { seedRoleTemplates } = await import("@/lib/services/roles");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone)
     values ($1, $2, 'O-06 Viewer', 'active', 'Asia/Kolkata')`,
    [tenantId, `o06-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Main', true),
       ($2, $3, 'Annex', false)`,
    [locMain, locAnnex, tenantId],
  );
  await seedRoleTemplates(tenantId);
  await admin.query(
    `insert into tenant_features (tenant_id, feature_key, enabled)
     values ($1, 'cafe.pos', true)`,
    [tenantId],
  );
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'O-06 Operator', 'h', 's', 'admin', 'active')`,
    [platformUserId, `o06-${RUN}@platform.test`],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actorId,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);

  // A real member with a distinctive name — the viewer must never
  // carry it.
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'ZZZ PII Probe')",
    [personId, tenantId],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code)
     values ($1, $2, $3, $4, 'active', $5)`,
    [memberId, tenantId, personId, locMain, `o06-${RUN}`],
  );

  await config.setTenantConfigValue({
    tenantId,
    key: KEY,
    value: 35,
    actorId,
  });
  await config.setTenantConfigValue({
    tenantId,
    key: KEY,
    value: 25,
    locationId: locAnnex,
    actorId,
  });
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("O-06 effective-configuration view", () => {
  it("resolves config with provenance and surfaces location overrides", async () => {
    const view = await getEffectiveConfiguration(tenantId);
    expect(view).not.toBeNull();
    if (!view) return;

    const threshold = view.config.find((c) => c.key === KEY);
    expect(threshold?.value).toBe(35);
    expect(threshold?.source).toMatchObject({
      scopeType: "tenant",
      scopeId: tenantId,
      setBy: actorId,
    });

    const annex = view.locationConfig.find((l) => l.locationId === locAnnex);
    const annexThreshold = annex?.values.find((v) => v.key === KEY);
    expect(annexThreshold?.value).toBe(25);
    expect(annexThreshold?.source).toMatchObject({
      scopeType: "location",
      scopeId: locAnnex,
    });

    // The main location still resolves the tenant value.
    const main = view.locationConfig.find((l) => l.locationId === locMain);
    expect(main?.values.find((v) => v.key === KEY)?.value).toBe(35);
  });

  it("carries entitlements with their source", async () => {
    const view = await getEffectiveConfiguration(tenantId);
    const override = view?.tenant.featureKeys.find((f) => f.key === "cafe.pos");
    expect(override?.source).toBe("tenant_override");
  });

  it("exposes the role/permission matrix", async () => {
    const view = await getEffectiveConfiguration(tenantId);
    const owner = view?.roles.find((r) => r.key === "owner");
    expect(owner).toBeTruthy();
    expect(owner?.permissions.length ?? 0).toBeGreaterThan(0);
    expect(owner?.homePath).toBe("/owner");
  });

  it("contains no member PII", async () => {
    const view = await getEffectiveConfiguration(tenantId);
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("ZZZ PII Probe");
    expect(serialised).not.toContain(memberId);
    expect(serialised).not.toContain(personId);
  });

  it("is PII-free at the source level too", () => {
    // Comments are stripped: the rule is about reads, and the module's
    // own doc comment names what it does not read.
    const source = readFileSync(
      join(process.cwd(), "db", "ops-configuration-view.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    for (const forbidden of [
      "persons",
      "members",
      "guardianships",
      "medicalNotes",
      "dateOfBirth",
    ]) {
      expect(source.includes(forbidden), forbidden).toBe(false);
    }
  });
});
