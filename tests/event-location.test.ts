import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// O-02 (docs/ops-platform-design.md §8) — the forward paths, proven
// against a real migrated database: generation copies the batch's
// location onto the session; marking copies the session's location
// onto the attendance row. Hermetic container, same fixture pattern
// as tests/mobile/wave2-schema.test.ts.

type TenantModule = typeof import("@/db/tenant");
type GeneratorModule = typeof import("@/lib/jobs/session-generator");
type RegisterModule = typeof import("@/lib/services/register");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let withTenant: TenantModule["withTenant"];
let generateSessions: GeneratorModule["generateSessions"];
let markAttendance: RegisterModule["markAttendance"];

const tenantId = asTenantId(uuidv7());
const userId = asUserId(uuidv7());
const locationId = uuidv7();
const programId = uuidv7();
const locatedBatchId = uuidv7();
const tenantWideBatchId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
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
  await runMigrations(adminUri);

  const tenantModule = await import("@/db/tenant");
  const generatorModule = await import("@/lib/jobs/session-generator");
  const registerModule = await import("@/lib/services/register");
  withTenant = tenantModule.withTenant;
  generateSessions = generatorModule.generateSessions;
  markAttendance = registerModule.markAttendance;

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'O-02 Service', 'active')",
    [tenantId, `o02-service-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await admin.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Squad')",
    [programId, tenantId],
  );
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id) values
       ($1, $3, $4, 'Located', 10, '{0,1,2,3,4,5,6}', '07:00', '08:00', $5),
       ($2, $3, $4, 'Tenant Wide', 10, '{0,1,2,3,4,5,6}', '09:00', '10:00', null)`,
    [locatedBatchId, tenantWideBatchId, tenantId, programId, locationId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'O-02 Member')",
    [personId, tenantId],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code)
     values ($1, $2, $3, $4, 'active', $5)`,
    [memberId, tenantId, personId, locationId, `o02-${RUN}`],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  // Close the app pool before the container stops, or pg emits an
  // unhandled "terminating connection" error on shutdown.
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("O-02 forward path", () => {
  it("generates sessions carrying their batch's location", async () => {
    const created = await withTenant(tenantId, (tx) =>
      generateSessions(tx, tenantId, "Asia/Kolkata"),
    );
    expect(created).toBeGreaterThan(0);

    const { rows } = await admin.query<{
      batch_id: string;
      location_id: string | null;
    }>("select distinct batch_id, location_id from sessions where tenant_id = $1", [
      tenantId,
    ]);
    const located = rows.filter((r) => r.batch_id === locatedBatchId);
    const wide = rows.filter((r) => r.batch_id === tenantWideBatchId);
    expect(located.length).toBeGreaterThan(0);
    expect(wide.length).toBeGreaterThan(0);
    for (const row of located) expect(row.location_id).toBe(locationId);
    for (const row of wide) expect(row.location_id).toBeNull();
  });

  it("marks attendance carrying its session's location", async () => {
    const { rows } = await admin.query<{ id: string }>(
      "select id from sessions where tenant_id = $1 and batch_id = $2 order by session_date limit 1",
      [tenantId, locatedBatchId],
    );
    const sessionId = rows[0].id;

    await markAttendance(
      { tenantId, userId },
      {
        sessionId,
        memberId,
        status: "present",
        clientId: `o02-mark-${RUN}`,
      },
    );

    const { rows: marks } = await admin.query<{ location_id: string | null }>(
      "select location_id from attendance where tenant_id = $1 and session_id = $2",
      [tenantId, sessionId],
    );
    expect(marks).toEqual([{ location_id: locationId }]);
  });
});
