import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";

// O-01 (docs/ops-platform-design.md §8) — migration backfill proofs.
//
// Why a disposable container: this is the only way to test the
// migration's *repair* branches honestly. The shared test DB is
// already migrated, so its tenants can never exercise "no location
// at all" or "two primaries" — exactly the pre-existing state the
// migration exists for. The container runs every migration *except*
// the target, seeds the pre-migration shape, then applies the target
// file last. Same fixture pattern as tests/mobile/wave2-schema.test.ts.

const TARGET = "20260914000000_ops_hierarchy.sql";

let container: StartedPostgreSqlContainer;
let admin: Pool;

const active = { noLocation: uuidv7(), nonePrimary: uuidv7(), twoPrimaries: uuidv7() };
const churned = uuidv7();
const hasFacilities = uuidv7();
const primaryFacilityLoc = uuidv7();
const oldLoc = uuidv7();
const newLoc = uuidv7();
const secondOld = uuidv7();
const secondNew = uuidv7();
const facilityNoLocation = uuidv7();
const facilityWithLocation = uuidv7();
const personNoLocation = uuidv7();
const personWithFacilities = uuidv7();
const staffNoLocation = uuidv7();
const staffWithFacilities = uuidv7();

const RUN = Date.now().toString(36);

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

  async function seedTenant(id: string, label: string, status: string) {
    await admin.query(
      "insert into tenants (id, slug, name, status) values ($1, $2, $3, $4)",
      [id, `o01-${label}-${RUN}`, `O-01 ${label}`, status],
    );
  }

  await seedTenant(active.noLocation, "no-location", "active");
  await seedTenant(active.nonePrimary, "none-primary", "active");
  await seedTenant(active.twoPrimaries, "two-primaries", "active");
  await seedTenant(churned, "churned", "churned");
  await seedTenant(hasFacilities, "with-facilities", "active");

  // nonePrimary: two live locations, neither primary.
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary, created_at) values
       ($1, $2, 'Old', false, '2026-01-01T00:00:00Z'),
       ($3, $2, 'New', false, '2026-02-01T00:00:00Z')`,
    [oldLoc, active.nonePrimary, newLoc],
  );

  // twoPrimaries: both marked primary; the older must win.
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary, created_at) values
       ($1, $2, 'Older', true, '2026-01-01T00:00:00Z'),
       ($3, $2, 'Newer', true, '2026-02-01T00:00:00Z')`,
    [secondOld, active.twoPrimaries, secondNew],
  );

  // hasFacilities: a well-formed tenant (this is the non-repair path).
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary, created_at) values
       ($1, $2, 'Main', true, '2026-01-01T00:00:00Z')`,
    [primaryFacilityLoc, hasFacilities],
  );

  // Pre-migration facilities have no location_id at all.
  await admin.query(
    `insert into facilities (id, tenant_id, name, kind, capacity) values
       ($1, $2, 'Orphan Pool', 'pool', 6),
       ($3, $4, 'Main Court', 'court', 2)`,
    [facilityNoLocation, active.noLocation, facilityWithLocation, hasFacilities],
  );

  // Pre-migration staff rows too — they must land on a location.
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $2, 'No Location Coach'),
       ($3, $4, 'Main Coach')`,
    [personNoLocation, active.noLocation, personWithFacilities, hasFacilities],
  );
  await admin.query(
    `insert into staff (id, tenant_id, person_id, staff_type) values
       ($1, $2, $3, 'coach'),
       ($4, $5, $6, 'coach')`,
    [
      staffNoLocation,
      active.noLocation,
      personNoLocation,
      staffWithFacilities,
      hasFacilities,
      personWithFacilities,
    ],
  );

  // Apply the target migration, exactly as db:migrate.ts would.
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

describe(`O-01 migration ${TARGET}`, () => {
  it("gives every pre-existing location kind 'club' by default", async () => {
    const { rows } = await admin.query<{ kind: string }>(
      "select kind from locations where id = $1",
      [primaryFacilityLoc],
    );
    expect(rows).toEqual([{ kind: "club" }]);
  });

  it("auto-creates a primary location for a tenant that has none", async () => {
    const { rows } = await admin.query<{
      name: string;
      is_primary: boolean;
      kind: string;
      n: string;
    }>(
      `select name, is_primary, kind, count(*) over ()::text as n
         from locations
        where tenant_id = $1 and deleted_at is null`,
      [active.noLocation],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Main Location",
      is_primary: true,
      kind: "club",
      n: "1",
    });
  });

  it("promotes the oldest location when none is primary", async () => {
    const { rows } = await admin.query<{ id: string; is_primary: boolean }>(
      `select id, is_primary from locations
        where tenant_id = $1 and deleted_at is null order by created_at`,
      [active.nonePrimary],
    );
    expect(rows).toEqual([
      { id: oldLoc, is_primary: true },
      { id: newLoc, is_primary: false },
    ]);
  });

  it("demotes extras when several locations claim primary", async () => {
    const { rows } = await admin.query<{ id: string; is_primary: boolean }>(
      `select id, is_primary from locations
        where tenant_id = $1 and deleted_at is null order by created_at`,
      [active.twoPrimaries],
    );
    expect(rows).toEqual([
      { id: secondOld, is_primary: true },
      { id: secondNew, is_primary: false },
    ]);
  });

  it("leaves a churned tenant with no locations untouched", async () => {
    const { rows } = await admin.query(
      "select 1 from locations where tenant_id = $1",
      [churned],
    );
    expect(rows).toHaveLength(0);
  });

  it("binds every facility to a location, including the adopted ones", async () => {
    const { rows: adopted } = await admin.query<{ id: string }>(
      "select id from locations where tenant_id = $1 and is_primary and deleted_at is null",
      [active.noLocation],
    );
    expect(adopted).toHaveLength(1);

    const { rows } = await admin.query<{
      id: string;
      location_id: string | null;
    }>(
      `select id, location_id from facilities where tenant_id in ($1, $2) order by name`,
      [active.noLocation, hasFacilities],
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.location_id).not.toBeNull();

    const orphan = rows.find((r) => r.id === facilityNoLocation);
    const located = rows.find((r) => r.id === facilityWithLocation);
    expect(located?.location_id).toBe(primaryFacilityLoc);
    expect(orphan?.location_id).toBe(adopted[0].id);
  });

  it("binds existing staff to their tenant's primary location", async () => {
    const { rows } = await admin.query<{
      staff_id: string;
      location_id: string;
      is_primary: boolean;
    }>(
      `select staff_id, location_id, is_primary
         from staff_locations where tenant_id in ($1, $2) order by staff_id`,
      [active.noLocation, hasFacilities],
    );
    expect(rows).toHaveLength(2);
    const noLoc = rows.find((r) => r.staff_id === staffNoLocation);
    const withFac = rows.find((r) => r.staff_id === staffWithFacilities);
    expect(noLoc?.is_primary).toBe(true);
    expect(withFac).toMatchObject({
      location_id: primaryFacilityLoc,
      is_primary: true,
    });
  });

  it("enforces the one-primary-per-tenant invariant mechanically", async () => {
    await expect(
      admin.query(
        "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Extra', true)",
        [uuidv7(), hasFacilities],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("enforces facilities.location_id NOT NULL mechanically", async () => {
    await expect(
      admin.query(
        "insert into facilities (id, tenant_id, name, kind, capacity) values ($1, $2, 'No Site', 'court', 1)",
        [uuidv7(), hasFacilities],
      ),
    ).rejects.toMatchObject({ code: "23502" });
  });
});
