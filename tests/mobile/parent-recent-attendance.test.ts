import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// 2026-10-05 audit FE-06 — the parent "recent" list selected the
// OLDEST eight marks (ascending order, then limit), so new attendance
// never appeared once history grew past the window. It must select the
// newest eight and display them chronologically.

type ParentViewModule = typeof import("@/lib/services/parent-view");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let parentView: ParentViewModule;

const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const userId = asUserId(uuidv7());
const locationId = uuidv7();
const programId = uuidv7();
const batchId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const TZ = "Asia/Kolkata";

const today = todayInZone(TZ);
const day = (n: number) => addDays(today, -n);

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";
  const appUri = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

  process.env.DATABASE_URL = appUri;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);

  parentView = await import("@/lib/services/parent-view");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Recent History', 'active', $3)",
    [tenantId, `recent-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Squad')",
    [programId, tenantId],
  );
  await admin.query(
    "insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id) values ($1, $2, $3, 'Junior TTS', 20, '{0,1,2,3,4,5,6}', '07:00', '08:00', $4)",
    [batchId, tenantId, programId, locationId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'Recent Subject', '2015-01-01')",
    [personId, tenantId],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, 'REC-1', 'active')",
    [memberId, tenantId, personId, locationId],
  );
  await admin.query(
    "insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on) values ($1, $2, $3, $4, $5)",
    [uuidv7(), tenantId, memberId, batchId, day(20)],
  );

  // Ten marked sessions, oldest at day(9) through newest at day(0).
  for (let i = 9; i >= 0; i--) {
    const sessionId = uuidv7();
    const dateIso = day(i);
    await admin.query(
      "insert into sessions (id, tenant_id, batch_id, session_date, starts_at, ends_at, status) values ($1, $2, $3, $4, $5, $5, 'held')",
      [sessionId, tenantId, batchId, dateIso, `${dateIso}T02:30:00.000Z`],
    );
    await admin.query(
      "insert into attendance (id, tenant_id, session_id, member_id, status, client_id) values ($1, $2, $3, $4, 'present', $5)",
      [uuidv7(), tenantId, sessionId, memberId, `recent-${RUN}-${i}`],
    );
  }
}, 240_000);

afterAll(async () => {
  if (admin) {
    await deleteAuditRowsForTenant(admin, tenantId);
    await admin.query("delete from attendance where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from members where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
    await admin.query("delete from users where id = $1::uuid", [userId]);
    await admin.end();
  }
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("parent recent attendance (FE-06)", () => {
  it("returns the newest eight marks in chronological display order", async () => {
    const view = await parentView.getParentViewData({
      tenantId,
      personId: memberId,
      today,
      monthStart: `${today.slice(0, 7)}-01`,
      monthEnd: today,
    });

    const recent = view?.attendance.recent ?? [];
    expect(recent).toHaveLength(8);

    const dates = recent.map((r) => r.sessionDate);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe(day(7));
    expect(dates[dates.length - 1]).toBe(day(0));
    expect(dates).not.toContain(day(9));
    expect(dates).not.toContain(day(8));
  });
});

// M05 (2026-10-09 role/content/permission audit) — the next-session
// DTO must carry the venue so the zero-JS parent page can show where
// the session is. The fixture's sessions have no session-level
// location, so the batch's location is the fallback the query must
// resolve.
describe("parent next-session venue (M05)", () => {
  it("returns the venue on the next session", async () => {
    const view = await parentView.getParentViewData({
      tenantId,
      personId: memberId,
      today,
      monthStart: `${today.slice(0, 7)}-01`,
      monthEnd: today,
    });

    expect(view?.nextSession?.batchName).toBe("Junior TTS");
    expect(view?.nextSession?.locationName).toBe("Main");
  });
});
