import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, asUserId } from "@/lib/ids";
import { MODULES } from "@/db/seed-platform";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// M-04 — module registry and contract. First run is deliberately red:
// the `modules` / `tenant_modules` tables and lib/services/modules.ts
// do not exist. Fixture rows go through the privileged migration pool;
// every app operation goes through the service under withTenant().

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const actor = asUserId(uuidv7());

const ctxA = { tenantId: tenantA, userId: actor };
const ctxB = { tenantId: tenantB, userId: actor };

let svc: typeof import("@/lib/services/modules");

async function auditCount(action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenantA, action],
  );
  return Number(rows[0]?.count ?? "0");
}

beforeAll(async () => {
  svc = await import("@/lib/services/modules");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Module A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Module B', 'active', 'Asia/Kolkata')`,
    [tenantA, `m04-a-${RUN}`, tenantB, `m04-b-${RUN}`],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9193${String(Date.now()).slice(-8)}`,
  ]);
}, 60_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantA);
  await deleteAuditRowsForTenant(admin, tenantB);
  await admin.query(
    "delete from tenant_modules where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from roles where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from tenants where id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query("delete from users where id = $1::uuid", [actor]);
  await admin.end();
});

describe("M-04 module registry contract", () => {
  it("every declared preset/config/feature key resolves against the real registry", async () => {
    const modules = (
      await admin.query<{
        key: string;
        preset_keys: string[];
        config_keys: string[];
        feature_keys: string[];
      }>(
        `select key, preset_keys, config_keys, feature_keys from modules order by key`,
      )
    ).rows.map((r) => ({
      key: r.key,
      presetKeys: r.preset_keys,
      configKeys: r.config_keys,
      featureKeys: r.feature_keys,
    }));

    const seeded = modules.map((m) => m.key);
    expect(seeded).toContain("swimming");
    expect(seeded).toContain("cafe");
    expect(modules.length).toBeGreaterThanOrEqual(2);

    // The migration and db/seed-platform.ts carry the same catalogue;
    // drift between the two copies is the failure this pins.
    expect([...seeded].sort()).toEqual(MODULES.map((m) => m.key).sort());
    for (const declaration of MODULES) {
      const dbRow = modules.find((m) => m.key === declaration.key);
      expect(dbRow?.presetKeys).toEqual(declaration.presetKeys);
      expect(dbRow?.configKeys).toEqual(declaration.configKeys);
      expect(dbRow?.featureKeys).toEqual(declaration.featureKeys);
    }

    const registry = {
      presetKeys: new Set(
        (
          await admin.query<{ key: string }>("select distinct key from presets")
        ).rows.map((r) => r.key),
      ),
      configKeys: new Set(
        (
          await admin.query<{ key: string }>("select key from config_keys")
        ).rows.map((r) => r.key),
      ),
      featureKeys: new Set(
        (await admin.query<{ key: string }>("select key from features")).rows.map(
          (r) => r.key,
        ),
      ),
    };

    expect(svc.findUnresolvedModuleKeys(modules, registry)).toEqual([]);

    // Declarations exist to be checked: if a module declared nothing the
    // contract would pass vacuously. Pin at least one of each kind.
    const all = modules.flatMap((m) => [
      ...m.presetKeys.map((key) => ["preset", key] as const),
      ...m.configKeys.map((key) => ["config", key] as const),
      ...m.featureKeys.map((key) => ["feature", key] as const),
    ]);
    for (const kind of ["preset", "config", "feature"]) {
      expect(all.some(([k]) => k === kind), `no ${kind} declaration`).toBe(true);
    }
  });

  it("fails the contract when a known-bad key is injected (mutation proof)", async () => {
    const registry = {
      presetKeys: new Set(["swimming"]),
      configKeys: new Set(["billing.gst_rate_bp"]),
      featureKeys: new Set(["members"]),
    };
    const unresolved = svc.findUnresolvedModuleKeys(
      [
        {
          key: "bad.module",
          presetKeys: ["swimming", "no_such_preset"],
          configKeys: ["billing.gst_rate_bp", "no_such_config"],
          featureKeys: ["members", "no_such_feature"],
        },
      ],
      registry,
    );
    expect(unresolved).toEqual([
      { moduleKey: "bad.module", kind: "preset", key: "no_such_preset" },
      { moduleKey: "bad.module", kind: "config", key: "no_such_config" },
      { moduleKey: "bad.module", kind: "feature", key: "no_such_feature" },
    ]);
  });
});

describe("M-04 listModulesForTenant / registerTenantModule", () => {
  it("lists every platform module with the tenant's enabled state", async () => {
    const before = await svc.listModulesForTenant(ctxA);
    const swimmingBefore = before.find((m) => m.key === "swimming");
    expect(swimmingBefore?.enabled).toBe(false);
    expect(swimmingBefore?.enabledVersion).toBeNull();

    const registered = await svc.registerTenantModule(ctxA, "swimming");
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(registered.idempotent).toBe(false);

    const after = await svc.listModulesForTenant(ctxA);
    const swimmingAfter = after.find((m) => m.key === "swimming");
    expect(swimmingAfter?.enabled).toBe(true);
    expect(swimmingAfter?.enabledVersion).toBe(swimmingAfter?.version);
    expect(swimmingAfter?.enabledAt).not.toBeNull();

    const cafe = after.find((m) => m.key === "cafe");
    expect(cafe?.enabled).toBe(false);
  });

  it("re-registering is idempotent and writes no second audit row", async () => {
    const again = await svc.registerTenantModule(ctxA, "swimming");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.idempotent).toBe(true);

    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from tenant_modules where tenant_id = $1 and module_key = 'swimming'",
      [tenantA],
    );
    expect(rows[0]?.count).toBe("1");
    expect(await auditCount("module.register")).toBe(1);
  });

  it("refuses an unknown module key", async () => {
    const result = await svc.registerTenantModule(ctxA, "no.such.module");
    expect(result.ok).toBe(false);
  });

  it("keeps tenant_modules tenant-isolated", async () => {
    const listed = await svc.listModulesForTenant(ctxB);
    expect(listed.every((m) => !m.enabled)).toBe(true);

    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from tenant_modules where tenant_id = $1",
      [tenantB],
    );
    expect(rows[0]?.count).toBe("0");
  });
});
