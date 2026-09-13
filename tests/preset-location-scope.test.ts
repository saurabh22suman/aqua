import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// O-03 (docs/ops-platform-design.md §3, §8) — preset applications bind
// to a location, with the interim first-wins rule for tenant-wide
// content: the first preset on a tenant owns terminology, roles,
// skills, plan shapes, templates and dashboard cards; later presets on
// other locations write location-scoped content only.
//
// Hermetic Testcontainer + the real platform catalogue, so the
// engine's locks run against real preset definitions.

type EngineModule = typeof import("@/db/preset-engine");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let applyPreset: EngineModule["applyPreset"];
let presetOfferedForKind: EngineModule["presetOfferedForKind"];

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
// applyPreset's O-05 audit row FK-references platform_users, so the
// actor must be a real operator row (production always passes one).
const actorId = asUserId(uuidv7());

const locA = uuidv7();
const locB = uuidv7();
const locD = uuidv7();
const locCafe = uuidv7();
const locP1 = uuidv7();
const locP2 = uuidv7();
const personB = uuidv7();
const memberB = uuidv7();

const RUN = Date.now().toString(36);

async function seedTenant(id: string, slug: string) {
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'O-03 Preset', 'active')",
    [id, `${slug}-${RUN}`],
  );
}

async function countRows(table: string, tenantId: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    `select count(*)::text as n from ${table} where tenant_id = $1::uuid`,
    [tenantId],
  );
  return Number(rows[0].n);
}

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

  const engine = await import("@/db/preset-engine");
  applyPreset = engine.applyPreset;
  presetOfferedForKind = engine.presetOfferedForKind;

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'O-03 Operator', 'h', 's', 'admin', 'active')`,
    [actorId, `o03-${RUN}@platform.test`],
  );
  await seedTenant(tenantA, "o03-a");
  await seedTenant(tenantB, "o03-b");
  await admin.query(
    `insert into locations (id, tenant_id, name, kind, is_primary) values
       ($1, $6, 'Worli', 'club', true),
       ($2, $6, 'Andheri', 'club', false),
       ($3, $6, 'Bandra Café', 'cafe', false),
       ($4, $6, 'Powai', 'club', false),
       ($5, $7, 'Primary', 'club', true)`,
    [locA, locB, locCafe, locD, locP1, tenantA, tenantB],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, kind, is_primary) values ($1, $2, 'Member Site', 'club', false)",
    [locP2, tenantB],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("O-03 preset location scope", () => {
  it("applies the owning preset to the primary location and stamps both records", async () => {
    const result = await applyPreset(tenantA, "swimming", { actorId });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.idempotent).toBe(false);

    const { rows: tenantRows } = await admin.query<{
      preset_key: string;
      preset_version: number;
    }>("select preset_key, preset_version from tenants where id = $1", [
      tenantA,
    ]);
    expect(tenantRows[0]).toMatchObject({ preset_key: "swimming" });

    const { rows: locRows } = await admin.query<{
      id: string;
      preset_key: string | null;
    }>(
      `select l.id, lp.preset_key
         from locations l
         left join location_presets lp on lp.location_id = l.id
        where l.tenant_id = $1
        order by l.name`,
      [tenantA],
    );
    const a = locRows.find((l) => l.id === locA);
    expect(a?.preset_key).toBe("swimming");
    expect(locRows.find((l) => l.id === locB)?.preset_key).toBeNull();

    const { rows: facilityRows } = await admin.query<{
      location_id: string;
      n: string;
    }>(
      "select location_id, count(*)::text as n from facilities where tenant_id = $1 group by location_id",
      [tenantA],
    );
    expect(facilityRows).toEqual([{ location_id: locA, n: "1" }]);

    const { rows: batchRows } = await admin.query<{
      location_id: string;
      n: string;
    }>(
      "select location_id, count(*)::text as n from batches where tenant_id = $1 group by location_id",
      [tenantA],
    );
    expect(batchRows).toEqual([{ location_id: locA, n: "2" }]);
  });

  it("re-applying to the same location is an idempotent no-op", async () => {
    const result = await applyPreset(tenantA, "swimming", {
      actorId,
      locationId: locA,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.idempotent).toBe(true);
  });

  it("applies the same preset to a second location without touching tenant-wide content", async () => {
    const before = {
      terminology: (
        await admin.query<{ terminology: unknown }>(
          "select terminology from tenants where id = $1",
          [tenantA],
        )
      ).rows[0].terminology,
      skills: await countRows("skill_levels", tenantA),
      plans: await countRows("plan_shapes", tenantA),
      roles: await countRows("roles", tenantA),
      templates: await countRows("message_templates", tenantA),
    };

    const result = await applyPreset(tenantA, "swimming", {
      actorId,
      locationId: locB,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.idempotent).toBe(false);

    const { rows } = await admin.query<{
      preset_key: string | null;
      n: string;
    }>(
      `select lp.preset_key, count(f.id)::text as n
         from location_presets lp
         left join facilities f on f.location_id = lp.location_id
        where lp.tenant_id = $1 and lp.location_id = $2
        group by lp.preset_key`,
      [tenantA, locB],
    );
    expect(rows).toEqual([{ preset_key: "swimming", n: "1" }]);

    const after = {
      terminology: (
        await admin.query<{ terminology: unknown }>(
          "select terminology from tenants where id = $1",
          [tenantA],
        )
      ).rows[0].terminology,
      skills: await countRows("skill_levels", tenantA),
      plans: await countRows("plan_shapes", tenantA),
      roles: await countRows("roles", tenantA),
      templates: await countRows("message_templates", tenantA),
    };
    expect(after).toEqual(before);

    const tenantRow = await admin.query<{ preset_key: string }>(
      "select preset_key from tenants where id = $1",
      [tenantA],
    );
    expect(tenantRow.rows[0].preset_key).toBe("swimming");
  });

  it("allows a different preset on another location and leaves the owner alone", async () => {
    const result = await applyPreset(tenantA, "multi-sport", {
      actorId,
      locationId: locD,
    });
    expect(result.kind).toBe("ok");

    const { rows } = await admin.query<{
      location_id: string;
      preset_key: string;
    }>(
      "select location_id, preset_key from location_presets where tenant_id = $1",
      [tenantA],
    );
    expect(rows.find((l) => l.location_id === locD)?.preset_key).toBe(
      "multi-sport",
    );
    expect(rows.find((l) => l.location_id === locA)?.preset_key).toBe(
      "swimming",
    );

    const tenantRow = await admin.query<{ preset_key: string }>(
      "select preset_key from tenants where id = $1",
      [tenantA],
    );
    expect(tenantRow.rows[0].preset_key).toBe("swimming");
  });

  it("refuses a different preset on a location that already has one", async () => {
    const result = await applyPreset(tenantA, "gym", {
      actorId,
      locationId: locA,
    });
    expect(result.kind).toBe("lock_active");
    if (result.kind === "lock_active") {
      expect(result.reason).toBe("different_preset_already_applied");
      expect(result.appliedKey).toBe("swimming");
    }
  });

  it("refuses a second location apply when that location already has members", async () => {
    const owning = await applyPreset(tenantB, "swimming", { actorId });
    expect(owning.kind).toBe("ok");

    // The member arrives after the owning apply: the location-scoped
    // lock is what this test is about, not the tenant-wide one.
    await admin.query(
      "insert into persons (id, tenant_id, full_name) values ($1, $2, 'O-03 Member')",
      [personB, tenantB],
    );
    await admin.query(
      `insert into members (id, tenant_id, person_id, location_id, status, member_code)
       values ($1, $2, $3, $4, 'active', $5)`,
      [memberB, tenantB, personB, locP2, `o03-${RUN}`],
    );

    const result = await applyPreset(tenantB, "multi-sport", {
      actorId,
      locationId: locP2,
    });
    expect(result.kind).toBe("lock_active");
    if (result.kind === "lock_active") {
      expect(result.reason).toBe("non_sample_member_exists");
    }
  });

  it("refuses a club preset on a café location", async () => {
    const result = await applyPreset(tenantA, "swimming", {
      actorId,
      locationId: locCafe,
    });
    expect(result.kind).toBe("location_not_eligible");
  });

  it("returns location_not_found for an unknown location id", async () => {
    const result = await applyPreset(tenantA, "swimming", {
      actorId,
      locationId: uuidv7(),
    });
    expect(result.kind).toBe("location_not_found");
  });

  it("offers start-from-scratch to any kind and club presets only to club/mixed", async () => {
    expect(presetOfferedForKind("start-from-scratch", "cafe")).toBe(true);
    expect(presetOfferedForKind("start-from-scratch", "club")).toBe(true);
    expect(presetOfferedForKind("swimming", "cafe")).toBe(false);
    expect(presetOfferedForKind("swimming", "club")).toBe(true);
    expect(presetOfferedForKind("swimming", "mixed")).toBe(true);
    expect(presetOfferedForKind("brand-new-preset", "club")).toBe(true);
  });
});
