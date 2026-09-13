import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";

// O-03 (docs/ops-platform-design.md §8) — location preset binding
// backfill: every preset applied before this migration was applied
// tenant-wide, which was effectively the primary location. Recording
// that keeps the per-location idempotence check honest.
//
// Disposable container, every migration except the target, same
// fixture pattern as tests/migrations/hierarchy-locations.test.ts.

const TARGET = "20260914020000_location_preset_binding.sql";

let container: StartedPostgreSqlContainer;
let admin: Pool;

const RUN = Date.now().toString(36);
const tenant = uuidv7();
const primaryLoc = uuidv7();
const secondLoc = uuidv7();
const plainTenant = uuidv7();
const plainLoc = uuidv7();
const appliedAt = "2026-08-14T10:00:00Z";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri, { upToExclusive: TARGET });

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    `insert into presets (key, version, name, description, definition, status)
     values ('swimming', 1, 'Swimming', 'Test preset', '{}'::jsonb, 'active')`,
  );
  await admin.query(
    `insert into tenants (id, slug, name, status, preset_key, preset_version, preset_applied_at)
     values ($1, $2, 'O-03 Backfill', 'active', 'swimming', 1, $3)`,
    [tenant, `o03-backfill-${RUN}`, appliedAt],
  );
  await admin.query(
    `insert into tenants (id, slug, name, status)
     values ($1, $2, 'O-03 Plain', 'active')`,
    [plainTenant, `o03-plain-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary, created_at) values
       ($1, $3, 'Main', true, '2026-01-01T00:00:00Z'),
       ($2, $3, 'Annex', false, '2026-02-01T00:00:00Z')`,
    [primaryLoc, secondLoc, tenant],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [plainLoc, plainTenant],
  );

  await admin.query("begin");
  await admin.query(
    readFileSync(join(process.cwd(), "db", "migrations", TARGET), "utf8"),
  );
  await admin.query("commit");
}, 240_000);

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

describe(`O-03 migration ${TARGET}`, () => {
  it("backfills the tenant's applied preset onto its primary location", async () => {
    const { rows } = await admin.query<{
      location_id: string;
      preset_key: string;
      preset_version: number;
      applied_at: Date;
    }>(
      "select location_id, preset_key, preset_version, applied_at from location_presets where tenant_id = $1",
      [tenant],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      location_id: primaryLoc,
      preset_key: "swimming",
      preset_version: 1,
    });
    expect(rows[0].applied_at.toISOString()).toBe(
      new Date(appliedAt).toISOString(),
    );

    const second = await admin.query(
      "select 1 from location_presets where location_id = $1",
      [secondLoc],
    );
    expect(second.rows).toHaveLength(0);
  });

  it("leaves a tenant with no applied preset unbound", async () => {
    const { rows } = await admin.query(
      "select 1 from location_presets where tenant_id = $1",
      [plainTenant],
    );
    expect(rows).toHaveLength(0);
  });

  it("allows only one binding per location", async () => {
    await expect(
      admin.query(
        `insert into location_presets (location_id, tenant_id, preset_key, preset_version)
         values ($1, $2, 'swimming', 1)`,
        [primaryLoc, tenant],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("enforces the preset FK mechanically", async () => {
    await expect(
      admin.query(
        `insert into location_presets (location_id, tenant_id, preset_key, preset_version)
         values ($1, $2, 'ghost', 9)`,
        [plainLoc, plainTenant],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
