import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";

// M-01 backfill proof. The migration adds `facilities.activity_type_key`
// and backfills existing rows by kind. The only honest way to test a
// backfill is to build the pre-migration schema, insert rows, then
// apply the migration: a post-migration insert can never reproduce the
// rows that already existed. Testcontainer-only (tests/migrations/ is
// the privileged-fixture directory) — no shared-DB state.

const M01 = "20260918120000_m01_activity_types.sql";

let container: StartedPostgreSqlContainer;
let admin: Pool;

const tenantId = uuidv7();
const locationId = uuidv7();

const KINDS = [
  "pool",
  "court",
  "turf",
  "studio",
  "field",
  "counter",
  "table",
] as const;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  // lib/env.ts cross-checks APP_LOGIN_PASSWORD against DATABASE_URL at
  // import time, so point both at the container before any dynamic
  // import touches @/lib/env (the subscriptions test does the same).
  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri, { upToExclusive: M01 });

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone)
     values ($1, $2, 'M-01 backfill', 'active', 'Asia/Kolkata')`,
    [tenantId, `m01-backfill-${Date.now().toString(36)}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );

  // Pre-migration shape: facilities has no activity_type_key yet.
  for (const kind of KINDS) {
    await admin.query(
      `insert into facilities (id, tenant_id, location_id, name, kind, capacity)
       values ($1, $2, $3, $4, $5, 10)`,
      [uuidv7(), tenantId, locationId, `Facility ${kind}`, kind],
    );
  }

  await runMigrations(adminUri);
}, 240_000);

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

describe("M-01 facilities.activity_type_key backfill", () => {
  it("backfills known kinds and leaves unmapped kinds null", async () => {
    const { rows } = await admin.query<{
      kind: string;
      activity_type_key: string | null;
    }>(
      `select kind, activity_type_key from facilities
        where tenant_id = $1::uuid order by kind`,
      [tenantId],
    );
    const mapped = Object.fromEntries(
      rows.map((r) => [r.kind, r.activity_type_key]),
    );
    expect(mapped).toEqual({
      pool: "swimming",
      court: "tennis",
      turf: "team_sport",
      studio: "fitness",
      field: null,
      counter: null,
      table: null,
    });
  });

  it("enforces the FK to activity_types", async () => {
    await expect(
      admin.query(
        `insert into facilities (id, tenant_id, location_id, name, kind, capacity, activity_type_key)
         values ($1, $2, $3, 'Bogus', 'pool', 1, 'nope')`,
        [uuidv7(), tenantId, locationId],
      ),
    ).rejects.toThrow(/foreign key/i);
  });
});
