import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, asUserId } from "@/lib/ids";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// M-05 — module versioning. First run is deliberately red:
// lib/services/modules.ts does not exist. Fixture rows (platform
// `modules`, tenants, members) go through the privileged migration
// pool; every app operation goes through the service under
// withTenant(), so audits are the real ones.
//
// The two lock tenants:
//   * emptyTenant has no members — non-additive apply/upgrade allowed.
//   * liveTenant has a member (never sample, per preset-engine rule 5)
//     — non-additive apply/upgrade refused, additive allowed.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const emptyTenant = asTenantId(uuidv7());
const liveTenant = asTenantId(uuidv7());
const actor = asUserId(uuidv7());

const ctxEmpty = { tenantId: emptyTenant, userId: actor };
const ctxLive = { tenantId: liveTenant, userId: actor };

const UPGRADE_MODULE = `test.upgrade.${RUN}`;
const LOCKED_MODULE = `test.locked.${RUN}`;

let svc: typeof import("@/lib/services/modules");

async function auditCount(tenantId: string, action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenantId, action],
  );
  return Number(rows[0]?.count ?? "0");
}

async function tenantModuleVersion(
  tenantId: string,
  key: string,
): Promise<number | null> {
  const { rows } = await admin.query<{ version: number }>(
    "select version from tenant_modules where tenant_id = $1 and module_key = $2",
    [tenantId, key],
  );
  return rows[0]?.version ?? null;
}

beforeAll(async () => {
  svc = await import("@/lib/services/modules");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Module Version Empty', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Module Version Live', 'active', 'Asia/Kolkata')`,
    [emptyTenant, `m05-empty-${RUN}`, liveTenant, `m05-live-${RUN}`],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [uuidv7(), liveTenant],
  );
  const personId = uuidv7();
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Live Member')",
    [personId, liveTenant],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code)
     select $1, $2, $3, id, 'active', $4 from locations
      where tenant_id = $2 and deleted_at is null limit 1`,
    [uuidv7(), liveTenant, personId, `MV-${RUN}`],
  );

  await admin.query(
    `insert into modules (key, name, version, status, capabilities, preset_keys, config_keys, feature_keys)
     values
       ($1, 'Upgrade test module', 1, 'beta', '{}'::jsonb, '{swimming}', '{billing.gst_rate_bp}', '{members}'),
       ($2, 'Locked test module', 1, 'beta', '{}'::jsonb, '{swimming}', '{billing.gst_rate_bp}', '{members}')`,
    [UPGRADE_MODULE, LOCKED_MODULE],
  );
}, 60_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, emptyTenant);
  await deleteAuditRowsForTenant(admin, liveTenant);
  await admin.query(
    "delete from tenant_modules where tenant_id in ($1::uuid, $2::uuid)",
    [emptyTenant, liveTenant],
  );
  await admin.query(
    "delete from members where tenant_id in ($1::uuid, $2::uuid)",
    [emptyTenant, liveTenant],
  );
  await admin.query(
    "delete from persons where tenant_id in ($1::uuid, $2::uuid)",
    [emptyTenant, liveTenant],
  );
  await admin.query(
    "delete from locations where tenant_id in ($1::uuid, $2::uuid)",
    [emptyTenant, liveTenant],
  );
  await admin.query(
    "delete from roles where tenant_id in ($1::uuid, $2::uuid)",
    [emptyTenant, liveTenant],
  );
  await admin.query(
    "delete from tenants where id in ($1::uuid, $2::uuid)",
    [emptyTenant, liveTenant],
  );
  await admin.query("delete from users where id = $1::uuid", [actor]);
  await admin.query("delete from modules where key in ($1, $2)", [
    UPGRADE_MODULE,
    LOCKED_MODULE,
  ]);
  await admin.end();
});

describe("M-05 applyModule", () => {
  it("applies a module once and audits it exactly once", async () => {
    const first = await svc.applyModule(ctxEmpty, UPGRADE_MODULE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.idempotent).toBe(false);
    expect(await tenantModuleVersion(emptyTenant, UPGRADE_MODULE)).toBe(1);
    expect(await auditCount(emptyTenant, "module.apply")).toBe(1);
  });

  it("re-applying changes nothing and audits nothing new", async () => {
    const again = await svc.applyModule(ctxEmpty, UPGRADE_MODULE);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.idempotent).toBe(true);
    expect(await tenantModuleVersion(emptyTenant, UPGRADE_MODULE)).toBe(1);
    expect(await auditCount(emptyTenant, "module.apply")).toBe(1);
  });

  it("refuses a non-additive apply once non-sample data exists", async () => {
    const refused = await svc.applyModule(ctxLive, LOCKED_MODULE);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/real|non-sample|lock/i);
    expect(await tenantModuleVersion(liveTenant, LOCKED_MODULE)).toBeNull();
    expect(await auditCount(liveTenant, "module.apply")).toBe(0);

    const additive = await svc.applyModule(ctxLive, LOCKED_MODULE, {
      additive: true,
    });
    expect(additive.ok).toBe(true);
    expect(await tenantModuleVersion(liveTenant, LOCKED_MODULE)).toBe(1);
    expect(await auditCount(liveTenant, "module.apply")).toBe(1);
  });
});

describe("M-05 upgradeModule", () => {
  it("refuses an upgrade beyond the registered version", async () => {
    const result = await svc.upgradeModule(ctxEmpty, UPGRADE_MODULE, 3);
    expect(result.ok).toBe(false);
    expect(await tenantModuleVersion(emptyTenant, UPGRADE_MODULE)).toBe(1);
    expect(await auditCount(emptyTenant, "module.upgrade")).toBe(0);
  });

  it("upgrades explicitly, audits once, and is idempotent on re-run", async () => {
    await admin.query("update modules set version = 2 where key = $1", [
      UPGRADE_MODULE,
    ]);

    const upgraded = await svc.upgradeModule(ctxEmpty, UPGRADE_MODULE, 2);
    expect(upgraded.ok).toBe(true);
    if (upgraded.ok) expect(upgraded.idempotent).toBe(false);
    expect(await tenantModuleVersion(emptyTenant, UPGRADE_MODULE)).toBe(2);
    expect(await auditCount(emptyTenant, "module.upgrade")).toBe(1);

    const again = await svc.upgradeModule(ctxEmpty, UPGRADE_MODULE, 2);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.idempotent).toBe(true);
    expect(await auditCount(emptyTenant, "module.upgrade")).toBe(1);
  });

  it("refuses a non-additive upgrade once non-sample data exists", async () => {
    await admin.query("update modules set version = 2 where key = $1", [
      LOCKED_MODULE,
    ]);

    const refused = await svc.upgradeModule(ctxLive, LOCKED_MODULE, 2);
    expect(refused.ok).toBe(false);
    expect(await tenantModuleVersion(liveTenant, LOCKED_MODULE)).toBe(1);
    expect(await auditCount(liveTenant, "module.upgrade")).toBe(0);

    const additive = await svc.upgradeModule(ctxLive, LOCKED_MODULE, 2, {
      additive: true,
    });
    expect(additive.ok).toBe(true);
    expect(await tenantModuleVersion(liveTenant, LOCKED_MODULE)).toBe(2);
    expect(await auditCount(liveTenant, "module.upgrade")).toBe(1);
  });

  it("refuses to upgrade a module that was never applied", async () => {
    const result = await svc.upgradeModule(ctxLive, UPGRADE_MODULE, 2);
    expect(result.ok).toBe(false);
  });
});
