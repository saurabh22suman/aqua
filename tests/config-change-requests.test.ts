import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// O-07 (docs/ops-platform-design.md §4) — owner-visible registry keys
// and the change-request path, against a real database.

let container: StartedPostgreSqlContainer;
let admin: Pool;
let ownerConfig: typeof import("@/db/config-owner");
let requests: typeof import("@/db/config-requests");

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const ownerUserId = asUserId(uuidv7());
const platformUserId = asUserId(uuidv7());
const RUN = Date.now().toString(36);

const ABSENCE_KEY = "attendance.absence_alert_threshold_pct" as const;
const OFFLINE_KEY = "attendance.offline_sync_enabled" as const;
const READ_KEY = "test.owner_read_flag";

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

  ownerConfig = await import("@/db/config-owner");
  requests = await import("@/db/config-requests");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    `insert into tenants (id, slug, name, status) values
       ($1, $2, 'O-07 A', 'active'),
       ($3, $4, 'O-07 B', 'active')`,
    [tenantA, `o07-a-${RUN}`, tenantB, `o07-b-${RUN}`],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    ownerUserId,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'O-07 Operator', 'h', 's', 'admin', 'active')`,
    [platformUserId, `o07-${RUN}@platform.test`],
  );
  // A fixture owner_read key: none ships in code yet, and the request
  // path must be provable now (the task's own empty-state note).
  await admin.query(
    `insert into config_keys (key, value_schema, default_value, visibility, risk, description)
     values ($1, '{"type":"boolean"}'::jsonb, 'false'::jsonb, 'owner_read', 'sensitive', 'Test read-only flag.')`,
    [READ_KEY],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("O-07 owner configuration", () => {
  it("lists owner_edit and owner_read keys but never ops_only", async () => {
    const items = await ownerConfig.listOwnerVisibleConfig(tenantA);
    const keys = items.map((item) => item.key);
    expect(keys).toContain(ABSENCE_KEY);
    expect(keys).not.toContain(OFFLINE_KEY);
    const absence = items.find((item) => item.key === ABSENCE_KEY);
    expect(absence?.editable).toBe(true);
    expect(absence?.visibility).toBe("owner_edit");
  });

  it("writes an owner_edit key through the registry with provenance", async () => {
    const result = await ownerConfig.setOwnerConfigValue(
      { tenantId: tenantA, userId: ownerUserId },
      ABSENCE_KEY,
      35,
    );
    expect(result.ok).toBe(true);

    const items = await ownerConfig.listOwnerVisibleConfig(tenantA);
    const absence = items.find((item) => item.key === ABSENCE_KEY);
    expect(absence?.value).toBe(35);
    expect(absence?.source).toMatchObject({
      scopeType: "tenant",
      setBy: ownerUserId,
    });
  });

  it("fails closed for owner_read and ops_only writes", async () => {
    const readOnly = await ownerConfig.setOwnerConfigValue(
      { tenantId: tenantA, userId: ownerUserId },
      READ_KEY,
      true,
    );
    expect(readOnly.ok).toBe(false);

    const opsOnly = await ownerConfig.setOwnerConfigValue(
      { tenantId: tenantA, userId: ownerUserId },
      OFFLINE_KEY,
      true,
    );
    expect(opsOnly.ok).toBe(false);

    const unknown = await ownerConfig.setOwnerConfigValue(
      { tenantId: tenantA, userId: ownerUserId },
      "not.a.key",
      1,
    );
    expect(unknown.ok).toBe(false);
  });

  it("accepts a change request for an owner_read key, with a tenant audit row", async () => {
    const result = await requests.requestConfigChange(
      { tenantId: tenantA, userId: ownerUserId },
      { key: READ_KEY, requestedValue: "on", note: "Reception needs branch scoping." },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await admin.query<{
      tenant_id: string;
      key: string;
      requested_value: string;
      status: string;
      requested_by: string;
    }>("select * from config_change_requests where id = $1", [result.requestId]);
    expect(rows.rows[0]).toMatchObject({
      tenant_id: tenantA,
      key: READ_KEY,
      requested_value: "on",
      status: "requested",
      requested_by: ownerUserId,
    });

    const audit = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1 and action = 'config.request'",
      [tenantA],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("refuses requests for keys that are not owner_read", async () => {
    const editable = await requests.requestConfigChange(
      { tenantId: tenantA, userId: ownerUserId },
      { key: ABSENCE_KEY, requestedValue: "10" },
    );
    expect(editable.ok).toBe(false);

    const opsOnly = await requests.requestConfigChange(
      { tenantId: tenantA, userId: ownerUserId },
      { key: OFFLINE_KEY, requestedValue: "on" },
    );
    expect(opsOnly.ok).toBe(false);

    const unknown = await requests.requestConfigChange(
      { tenantId: tenantA, userId: ownerUserId },
      { key: "not.a.key", requestedValue: "x" },
    );
    expect(unknown.ok).toBe(false);
  });

  it("lists requests for the tenant only, and resolves them once", async () => {
    const pending = await requests.listConfigChangeRequests(tenantA);
    expect(pending).toHaveLength(1);
    expect(pending[0].tenantName).toBe("O-07 A");
    expect(pending[0].status).toBe("requested");

    const otherTenant = await requests.listConfigChangeRequests(tenantB);
    expect(otherTenant).toHaveLength(0);

    const resolved = await requests.resolveConfigChangeRequest({
      requestId: pending[0].id,
      status: "resolved",
      resolutionNote: "Enabled after a call.",
      actorId: platformUserId,
    });
    expect(resolved.ok).toBe(true);

    const after = await requests.listConfigChangeRequests(tenantA);
    expect(after[0]).toMatchObject({
      status: "resolved",
      resolutionNote: "Enabled after a call.",
      resolvedBy: platformUserId,
    });

    const audit = await admin.query<{ action: string }>(
      "select action from platform_audit_log where action = 'config.request.resolve'",
    );
    expect(audit.rows).toHaveLength(1);

    const again = await requests.resolveConfigChangeRequest({
      requestId: pending[0].id,
      status: "declined",
      actorId: platformUserId,
    });
    expect(again.ok).toBe(false);
  });

  it("keeps requests tenant-isolated under RLS", async () => {
    await requests.requestConfigChange(
      { tenantId: tenantA, userId: ownerUserId },
      { key: READ_KEY, requestedValue: "off" },
    );

    const { withTenant } = await import("@/db/tenant");
    const { configChangeRequests } = await import("@/db/schema/config");
    const rowsForB = await withTenant(tenantB, (tx) =>
      tx.select().from(configChangeRequests),
    );
    expect(rowsForB).toHaveLength(0);

    const rowsForA = await withTenant(tenantA, (tx) =>
      tx.select().from(configChangeRequests),
    );
    expect(rowsForA.length).toBeGreaterThan(0);
  });
});
