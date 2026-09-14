import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";

// O-02 (docs/ops-platform-design.md §8) — sessions and attendance
// carry the location of the event, backfilled from the batch chain.
//
// Disposable container + every migration except the target, same
// fixture pattern as tests/migrations/hierarchy-locations.test.ts:
// the shared test DB is already migrated, so it can never exercise
// the backfill against pre-existing sessions.

const TARGET = "20260914010000_event_location.sql";

let container: StartedPostgreSqlContainer;
let admin: Pool;

const RUN = Date.now().toString(36);

const tenantA = uuidv7();
const tenantB = uuidv7();
const locA = uuidv7();
const locB = uuidv7();
const programId = uuidv7();
const batchWithLoc = uuidv7();
const batchNoLoc = uuidv7();
const sessionWithLoc = uuidv7();
const sessionNoLoc = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();

async function seedTenant(id: string, slug: string) {
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'O-02 Event', 'active')",
    [id, `${slug}-${RUN}`],
  );
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
  await runMigrations(adminUri, { upToExclusive: TARGET });

  admin = new Pool({ connectionString: adminUri });

  await seedTenant(tenantA, "o02-a");
  await seedTenant(tenantB, "o02-b");
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Hall A', true),
       ($2, $4, 'Hall B', true)`,
    [locA, locB, tenantA, tenantB],
  );
  await admin.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Squad')",
    [programId, tenantA],
  );
  // One batch with a site, one deliberately tenant-wide.
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id) values
       ($1, $3, $4, 'Located', 10, '{1}', '07:00', '08:00', $5),
       ($2, $3, $4, 'Tenant Wide', 10, '{1}', '09:00', '10:00', null)`,
    [batchWithLoc, batchNoLoc, tenantA, programId, locA],
  );
  await admin.query(
    `insert into sessions (id, tenant_id, batch_id, session_date, starts_at, ends_at, status) values
       ($1, $3, $4, '2026-09-01', '2026-09-01T07:00:00Z', '2026-09-01T08:00:00Z', 'held'),
       ($2, $3, $5, '2026-09-02', '2026-09-02T09:00:00Z', '2026-09-02T10:00:00Z', 'held')`,
    [sessionWithLoc, sessionNoLoc, tenantA, batchWithLoc, batchNoLoc],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Event Member')",
    [personId, tenantA],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code)
     values ($1, $2, $3, $4, 'active', $5)`,
    [memberId, tenantA, personId, locA, `o02-${RUN}`],
  );
  await admin.query(
    `insert into attendance (id, tenant_id, session_id, member_id, status, client_id) values
       ($1, $2, $3, $4, 'present', $5),
       (gen_random_uuid(), $2, $6, $4, 'absent', $7)`,
    [
      uuidv7(),
      tenantA,
      sessionWithLoc,
      memberId,
      `c1-${RUN}`,
      sessionNoLoc,
      `c2-${RUN}`,
    ],
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

describe(`O-02 migration ${TARGET}`, () => {
  it("backfills a session from its batch's location", async () => {
    const { rows } = await admin.query<{ location_id: string | null }>(
      "select location_id from sessions where id = $1",
      [sessionWithLoc],
    );
    expect(rows[0].location_id).toBe(locA);
  });

  it("keeps a tenant-wide session tenant-wide instead of guessing", async () => {
    const { rows } = await admin.query<{ location_id: string | null }>(
      "select location_id from sessions where id = $1",
      [sessionNoLoc],
    );
    expect(rows[0].location_id).toBeNull();
  });

  it("backfills attendance from its session", async () => {
    const { rows } = await admin.query<{
      session_id: string;
      location_id: string | null;
    }>(
      `select session_id, location_id from attendance
        where session_id in ($1, $2) order by session_id`,
      [sessionWithLoc, sessionNoLoc],
    );
    const located = rows.find((r) => r.session_id === sessionWithLoc);
    const wide = rows.find((r) => r.session_id === sessionNoLoc);
    expect(located?.location_id).toBe(locA);
    expect(wide?.location_id).toBeNull();
  });

  it("rejects a session pointing at another tenant's location", async () => {
    await expect(
      admin.query(
        `insert into sessions (id, tenant_id, batch_id, location_id, session_date, starts_at, ends_at, status)
         values ($1, $2, $3, $4, '2026-10-01', '2026-10-01T07:00:00Z', '2026-10-01T08:00:00Z', 'scheduled')`,
        [uuidv7(), tenantA, batchWithLoc, locB],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("blocks hard-deleting a location that a session still references", async () => {
    // Point a session at a fresh location referenced by nothing else,
    // so the failure can only come from the sessions FK.
    const orphanLoc = uuidv7();
    await admin.query(
      "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Event Only', false)",
      [orphanLoc, tenantA],
    );
    await admin.query(
      "update sessions set location_id = $1 where id = $2",
      [orphanLoc, sessionNoLoc],
    );
    await expect(
      admin.query("delete from locations where id = $1", [orphanLoc]),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
