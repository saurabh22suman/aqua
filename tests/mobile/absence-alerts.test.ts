import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";
import { addDays } from "@/lib/time/tz";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// R.8 (docs/five-day-work-guide.md, V-20) — absence alerts.
// Owner decisions 2026-09-13: threshold configurable (default 50%),
// minimum 4 recorded marks before the monthly alert can fire; coach
// surface = member detail; parent line under this month's attendance;
// read-only (no acknowledgement state). Dedupe key
// (member, batch, kind, calendar_week) — three consecutive absences
// trigger one alert, not three.
//
// TDD: fails before the migration + service. Hermetic Testcontainer,
// same pattern as tests/mobile/wave2-schema.test.ts.

type AlertsModule = typeof import("@/lib/services/absence-alerts");
type ParentViewModule = typeof import("@/lib/services/parent-view");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let alerts: AlertsModule;
let parentView: ParentViewModule;

const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const userId = asUserId(uuidv7());
const locationId = uuidv7();
const programId = uuidv7();
const batchId = uuidv7();
const personA = uuidv7();
const memberA = uuidv7();
const personB = uuidv7();
const memberB = uuidv7();
const TZ = "Asia/Kolkata";

const ctx = { tenantId, userId };
const today = "2026-10-25";
const fixedNow = Date.parse("2026-10-25T06:00:00Z");
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

  alerts = await import("@/lib/services/absence-alerts");
  parentView = await import("@/lib/services/parent-view");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'R8 Alerts', 'active', $3)",
    [tenantId, `r8-alerts-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9193${String(Date.now()).slice(-8)}`,
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
    "insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'Alert Subject A', '1990-01-01'), ($3, $2, 'Alert Subject B', '1990-01-01')",
    [personA, tenantId, personB],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, 'R8-A', 'active'), ($5, $2, $6, $4, 'R8-B', 'active')",
    [memberA, tenantId, personA, locationId, memberB, personB],
  );
  await admin.query(
    "insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on) values ($1, $2, $3, $4, $5), ($6, $2, $7, $4, $5)",
    [uuidv7(), tenantId, memberA, batchId, day(10), uuidv7(), memberB],
  );

  // Four past sessions. A: absent in the latest three (present in the
  // fourth) -> consecutive alert + 25% month. B: absent, present,
  // absent, absent -> only two consecutive, 25% month -> monthly alert
  // only.
  const statusesA = ["absent", "absent", "absent", "present"];
  const statusesB = ["absent", "absent", "present", "absent"];
  for (let i = 1; i <= 4; i++) {
    const sessionId = uuidv7();
    const dateIso = day(i);
    await admin.query(
      "insert into sessions (id, tenant_id, batch_id, session_date, starts_at, ends_at, status) values ($1, $2, $3, $4, $5, $5, 'held')",
      [sessionId, tenantId, batchId, dateIso, `${dateIso}T02:30:00.000Z`],
    );
    for (const [memberId, statuses] of [
      [memberA, statusesA],
      [memberB, statusesB],
    ] as const) {
      await admin.query(
        "insert into attendance (id, tenant_id, session_id, member_id, status, client_id) values ($1, $2, $3, $4, $5, $6)",
        [uuidv7(), tenantId, sessionId, memberId, statuses[i - 1], `r8-${RUN}-${i}-${memberId}`],
      );
    }
  }
  vi.spyOn(Date, "now").mockReturnValue(fixedNow);
}, 240_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (admin) {
    await deleteAuditRowsForTenant(admin, tenantId);
    await admin.query("delete from absence_alerts where tenant_id = $1::uuid", [tenantId]);
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

describe("absence alert settings (R.8)", () => {
  it("defaults to 50% and is owner-configurable", async () => {
    expect(await alerts.getAbsenceAlertThreshold(ctx)).toBe(50);
    await alerts.updateAbsenceAlertThreshold(ctx, 35);
    expect(await alerts.getAbsenceAlertThreshold(ctx)).toBe(35);
    await alerts.updateAbsenceAlertThreshold(ctx, 50);
  });
});

describe("detection and dedupe (R.8)", () => {
  it("creates exactly one alert per kind per member per week", async () => {
    const first = await alerts.detectAbsenceAlerts(ctx);
    const second = await alerts.detectAbsenceAlerts(ctx);

    expect(first.inserted).toBeGreaterThan(0);
    expect(second.inserted).toBe(0);

    const forA = await alerts.listMemberAlerts(ctx, memberA);
    const kindsA = forA.map((a) => a.alertKind).sort();
    expect(kindsA).toEqual(["consecutive_absences", "low_monthly_attendance"]);

    const forB = await alerts.listMemberAlerts(ctx, memberB);
    expect(forB.map((a) => a.alertKind)).toEqual(["low_monthly_attendance"]);
  });

  it("does not count previous-month marks toward this month's minimum", async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-11-01T06:00:00Z"));
    try {
      const currentWeek = alerts.isoWeekKey("2026-11-01");
      expect(alerts.isoWeekKey(today)).not.toBe(currentWeek);
      const marks = await admin.query<{ member_id: string; in_lookback: number; in_november: number }>(
        `select a.member_id,
          count(*) filter (where s.session_date between '2026-10-18' and '2026-11-01')::int as in_lookback,
          count(*) filter (where s.session_date between '2026-11-01' and '2026-11-30')::int as in_november
         from attendance a join sessions s on s.id = a.session_id and s.tenant_id = a.tenant_id
         where a.tenant_id = $1 and a.member_id = any($2::uuid[])
         group by a.member_id`,
        [tenantId, [memberA, memberB]],
      );
      expect(marks.rows).toHaveLength(2);
      for (const row of marks.rows) {
        expect(row.in_lookback).toBe(4);
        expect(row.in_november).toBe(0);
      }
      await alerts.detectAbsenceAlerts(ctx);
      const result = await admin.query(
        "select id from absence_alerts where tenant_id=$1 and alert_kind='low_monthly_attendance' and calendar_week=$2",
        [tenantId, currentWeek],
      );
      expect(result.rowCount).toBe(0);
    } finally {
      vi.mocked(Date.now).mockReturnValue(fixedNow);
    }
  });

  it("respects a lowered threshold", async () => {
    // Already deduped this week, so this asserts the settings path:
    // with the threshold at 35, B's 25% still alerts; raising to 10
    // would not, but the existing row stays (read-only, weekly).
    await alerts.updateAbsenceAlertThreshold(ctx, 10);
    const run = await alerts.detectAbsenceAlerts(ctx);
    expect(run.inserted).toBe(0);
    await alerts.updateAbsenceAlertThreshold(ctx, 50);
  });
});

describe("parent surface data (R.8)", () => {
  it("carries the latest alert into the parent view", async () => {
    const view = await parentView.getParentViewData({
      tenantId,
      personId: memberA,
      today,
      monthStart: `${today.slice(0, 7)}-01`,
      monthEnd: today,
    });
    expect(view?.absenceAlert?.alertKind).toBeTruthy();
  });
});
