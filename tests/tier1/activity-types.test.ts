import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, asUserId } from "@/lib/ids";
import { ACTIVITY_TYPES } from "@/db/seed-platform";

// M-01 — activity type catalog. First run is deliberately red: the
// `activity_types` table and `lib/services/activity-types.ts` do not
// exist. Fixture rows for tenants/locations/users/facilities (FORCE
// RLS) go through the privileged migration pool; every app operation
// goes through the service, so the RLS path is the real one.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const actor = asUserId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const poolA = uuidv7();
const fieldA = uuidv7();

const ctxA = { tenantId: tenantA, userId: actor };

let svc: typeof import("@/lib/services/activity-types");

beforeAll(async () => {
  svc = await import("@/lib/services/activity-types");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Activity Types A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Activity Types B', 'active', 'Asia/Kolkata')`,
    [tenantA, `m01-a-${RUN}`, tenantB, `m01-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Main A', true), ($2, $4, 'Main B', true)`,
    [locA, locB, tenantA, tenantB],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9191${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity, activity_type_key)
     values
       ($1, $2, $3, 'Main pool', 'pool', 40, 'swimming'),
       ($4, $2, $3, 'Far field', 'field', 60, null)
     `,
    [poolA, tenantA, locA, fieldA],
  );
}, 60_000);

afterAll(async () => {
  await admin.query(
    "delete from facilities where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from locations where tenant_id in ($1::uuid, $2::uuid)",
    [tenantA, tenantB],
  );
  await admin.query(
    "delete from tenant_memberships where tenant_id in ($1::uuid, $2::uuid)",
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
  await admin.query("delete from activity_types where key = 'bare'");
  await admin.end();
});

describe("M-01 activity type catalogue", () => {
  it("lists the seeded activity types with their capability flags", async () => {
    const types = await svc.listActivityTypes();
    const byKey = new Map(types.map((t) => [t.key, t]));

    for (const key of ["swimming", "tennis", "fitness", "team_sport", "cafe"]) {
      expect(byKey.has(key), `missing activity type: ${key}`).toBe(true);
    }

    expect(byKey.get("swimming")?.capabilities).toMatchObject({
      bookable: true,
      attendance: true,
      progress: true,
      resource_based: true,
      pos: false,
    });
    expect(byKey.get("cafe")?.capabilities).toMatchObject({
      bookable: false,
      attendance: false,
      progress: false,
      resource_based: false,
      pos: true,
    });

    // The migration and db/seed-platform.ts carry the same catalogue;
    // drift between the two copies is the failure this pins.
    expect([...byKey.keys()].filter((k) => k !== "bare").sort()).toEqual(
      ACTIVITY_TYPES.map((t) => t.key).sort(),
    );
    for (const seedRow of ACTIVITY_TYPES) {
      expect(byKey.get(seedRow.key)?.capabilities).toEqual(seedRow.capabilities);
    }
  });

  it("reads capabilities for a single key and returns null for unknown keys", async () => {
    const caps = await svc.getActivityTypeCapabilities("swimming");
    expect(caps).toEqual({
      bookable: true,
      attendance: true,
      progress: true,
      resource_based: true,
      pos: false,
    });

    expect(await svc.getActivityTypeCapabilities("no_such_type")).toBeNull();
  });

  it("normalises a row with default '{}' capabilities to all-false", async () => {
    await admin.query(
      `insert into activity_types (key, name, capabilities) values ('bare', 'Bare', '{}'::jsonb)
       on conflict (key) do nothing`,
    );
    const caps = await svc.getActivityTypeCapabilities("bare");
    expect(caps).toEqual({
      bookable: false,
      attendance: false,
      progress: false,
      resource_based: false,
      pos: false,
    });
  });

  it("lists a tenant's activities with their type and capabilities, tenant-scoped", async () => {
    const rows = await svc.listActivitiesForTenant(ctxA);
    const pool = rows.find((r) => r.id === poolA);
    expect(pool?.activityTypeKey).toBe("swimming");
    expect(pool?.capabilities?.progress).toBe(true);

    const field = rows.find((r) => r.id === fieldA);
    expect(field?.activityTypeKey).toBeNull();
    expect(field?.capabilities).toBeNull();

    const rowsB = await svc.listActivitiesForTenant({
      tenantId: tenantB,
      userId: actor,
    });
    expect(rowsB).toEqual([]);
  });

  it("is tenant-isolated at the database layer for the linked key", async () => {
    // A facility's activity_type_key must reference a real platform row.
    await expect(
      admin.query(
        `insert into facilities (id, tenant_id, location_id, name, kind, capacity, activity_type_key)
         values ($1, $2, $3, 'Bogus', 'pool', 1, 'not_a_type')`,
        [uuidv7(), tenantA, locA],
      ),
    ).rejects.toThrow(/foreign key/i);
    const nullable = await admin.query(
      `insert into facilities (id, tenant_id, location_id, name, kind, capacity, activity_type_key)
       values ($1, $2, $3, 'Unmapped', 'field', 1, NULL)
       returning activity_type_key`,
      [uuidv7(), tenantA, locA],
    );
    expect(nullable.rows[0]?.activity_type_key).toBeNull();
  });
});
