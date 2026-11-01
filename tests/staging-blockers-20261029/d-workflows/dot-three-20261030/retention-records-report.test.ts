// @vitest-environment node
//
// Task D, PHASE2 — the retention report as a factual RECORDS SUMMARY.
//
// The human approved (30 October 2026, docs/audits/.../HUMAN-APPROVED-
// RETENTION-DEFINITION.md) that the owner view shows "Attendance records
// to review": an aggregate count of the active members who were here for
// the whole period and have NO attendance record in it.
//
//   * A RECORD is any recorded mark — present, late OR absent.
//   * A member with no mark is UNKNOWN. It is never relabelled absent,
//     never a churn claim and never a risk score.
//   * The COHORT is active, not deleted, with a known join date on or
//     before the period start, inside the caller's tenant/location
//     access. A newer member's marks cannot subtract from it.
//   * The PERIOD is the tenant's own last 30 calendar days including
//     today: local midnight 29 days before today through the read time.
//     Cancelled and not-yet-started sessions are excluded.
//
// The database is a throwaway Postgres 16 (tests/helpers/isolated-db)
// with the real migrations and the real app_login role, so the SQL
// predicates are exercised as they ship.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { IsolatedDb } from "@/tests/helpers/isolated-db";
import type { ActionCtx } from "@/lib/auth/context";
import type { RetentionReport } from "@/lib/services/owner-reports";
import type { TenantId } from "@/lib/ids";
import { asUserId } from "@/lib/ids";

let db: IsolatedDb;
const seededTenants: string[] = [];

// Asia/Kolkata is UTC+05:30 all year (no daylight saving), so its wall
// clock is a fixed offset from UTC. The suite derives IST instants
// itself instead of importing the production helper: a bug in that
// helper must not make the window assertions agree with themselves.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function todayIst(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The UTC instant of an IST wall-clock time on a local calendar day. */
function istInstant(dateIso: string, wallTime: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = wallTime.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MS);
}

type MemberSpec = {
  key: string;
  /** null = the member's join date is unknown. */
  joinedOn: string | null;
  status?: "active" | "paused" | "left";
  location?: "a" | "b";
};

type SessionSpec = {
  key: string;
  /** The session's LOCAL calendar day (sessions.session_date). */
  date: string;
  /** The instant the session starts (sessions.starts_at). */
  startsAt: Date;
  status?: "scheduled" | "held" | "cancelled";
  location?: "a" | "b";
};

type MarkSpec = {
  session: string;
  member: string;
  status: "present" | "late" | "absent";
};

type Fixture = {
  tenantId: TenantId;
  locations: Record<"a" | "b", string>;
  members: Record<string, string>;
  sessions: Record<string, string>;
};

async function seedTenant(options: {
  members?: MemberSpec[];
  sessions?: SessionSpec[];
  marks?: MarkSpec[];
  /** Turns the O-08 location boundary on for this tenant. */
  locationScoped?: boolean;
}): Promise<Fixture> {
  const tenantId = randomUUID();
  const locationA = randomUUID();
  const locationB = randomUUID();
  const programId = randomUUID();
  seededTenants.push(tenantId);

  await db.admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Records Summary', 'active', 'Asia/Kolkata')",
    [tenantId, `records-${tenantId}`],
  );
  await db.admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $3, 'A', true), ($2, $3, 'B', false)",
    [locationA, locationB, tenantId],
  );
  await db.admin.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Programme')",
    [programId, tenantId],
  );

  const members: Record<string, string> = {};
  for (const spec of options.members ?? []) {
    const memberId = randomUUID();
    const personId = randomUUID();
    members[spec.key] = memberId;
    await db.admin.query(
      "insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, $3, '2014-01-01')",
      [personId, tenantId, `Member ${spec.key}`],
    );
    await db.admin.query(
      `insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        memberId,
        tenantId,
        personId,
        spec.location === "b" ? locationB : locationA,
        `REC-${memberId.slice(0, 8)}`,
        spec.status ?? "active",
        spec.joinedOn,
      ],
    );
  }

  const sessions: Record<string, string> = {};
  for (const spec of options.sessions ?? []) {
    const sessionId = randomUUID();
    // One batch per session: sessions are unique per (batch, date), and
    // the batch carries the location the session runs at.
    const batchId = randomUUID();
    sessions[spec.key] = sessionId;
    await db.admin.query(
      `insert into batches (id, tenant_id, program_id, location_id, name, capacity, start_time, end_time)
       values ($1, $2, $3, $4, $5, 10, '07:00', '08:00')`,
      [batchId, tenantId, programId, spec.location === "b" ? locationB : locationA, `Batch ${spec.key}`],
    );
    await db.admin.query(
      `insert into sessions (id, tenant_id, batch_id, location_id, session_date, starts_at, ends_at, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        sessionId,
        tenantId,
        batchId,
        spec.location === "b" ? locationB : locationA,
        spec.date,
        spec.startsAt,
        new Date(spec.startsAt.getTime() + 60 * 60 * 1000),
        spec.status ?? "scheduled",
      ],
    );
  }

  for (const spec of options.marks ?? []) {
    const memberId = members[spec.member];
    const sessionId = sessions[spec.session];
    if (!memberId || !sessionId) throw new Error(`unknown fixture handle ${spec.member}/${spec.session}`);
    const session = (options.sessions ?? []).find((s) => s.key === spec.session);
    await db.admin.query(
      `insert into attendance (id, tenant_id, session_id, member_id, location_id, status, client_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        tenantId,
        sessionId,
        memberId,
        session?.location === "b" ? locationB : locationA,
        spec.status,
        randomUUID(),
      ],
    );
  }

  if (options.locationScoped) {
    await db.admin.query(
      "insert into config_values (id, key, scope_type, scope_id, tenant_id, value) values ($1, 'access.location_scoped_staff', 'tenant', $2::text, $2::uuid, 'true')",
      [randomUUID(), tenantId],
    );
  }

  return {
    tenantId: tenantId as TenantId,
    locations: { a: locationA, b: locationB },
    members,
    sessions,
  };
}

// The service reads the app pool, which is built from DATABASE_URL at
// import time — so the URL must be in place before the module graph
// loads, and the module is imported ONCE (a reset would orphan the
// pool that holds the connection).
type RetentionFn = (ctx: ActionCtx) => Promise<RetentionReport>;
let getRetentionReport: RetentionFn;

beforeAll(async () => {
  // lib/env.ts parses process.env ONCE, and db/client.ts builds its
  // pool from that parsed DATABASE_URL. The isolated database's URL is
  // only known after the container starts, so the module graph has to
  // be reset once the URL is in place.
  vi.resetModules();
  const { startIsolatedDb } = await import("@/tests/helpers/isolated-db");
  db = await startIsolatedDb();
  process.env.DATABASE_URL = db.appUri;
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  vi.resetModules();
  ({ getRetentionReport } = await import("@/lib/services/owner-reports"));
}, 180_000);

afterAll(async () => {
  const { pool } = await import("@/db/client");
  await pool.end();
  for (const tenantId of seededTenants) {
    await db.admin.query("delete from attendance where tenant_id = $1", [tenantId]);
    await db.admin.query("delete from sessions where tenant_id = $1", [tenantId]);
    await db.admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await db.admin.query("delete from members where tenant_id = $1", [tenantId]);
    await db.admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await db.admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await db.admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await db.admin.query("delete from config_values where tenant_id = $1", [tenantId]);
    await db.admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await db.stop();
});

const TODAY = todayIst();
const DAYS_AGO = (days: number) => addDaysIso(TODAY, -days);

describe("attendance records to review — the cohort and its records", () => {
  it("counts an eligible member with no mark, and never lets a newer member's mark subtract from it", async () => {
    // Three members who joined long before the period, one who joined
    // inside it. present/late/absent are all records; the unmarked
    // member is the only one without one. The newer member's mark
    // belongs to a different cohort and must not touch the count.
    const fixture = await seedTenant({
      members: [
        { key: "present", joinedOn: DAYS_AGO(200) },
        { key: "late", joinedOn: DAYS_AGO(200) },
        { key: "absent", joinedOn: DAYS_AGO(200) },
        { key: "unmarked", joinedOn: DAYS_AGO(200) },
        { key: "newer", joinedOn: DAYS_AGO(3) },
      ],
      sessions: [
        {
          key: "s1",
          date: DAYS_AGO(2),
          startsAt: istInstant(DAYS_AGO(2), "07:00"),
        },
      ],
      marks: [
        { session: "s1", member: "present", status: "present" },
        { session: "s1", member: "late", status: "late" },
        { session: "s1", member: "absent", status: "absent" },
        { session: "s1", member: "newer", status: "present" },
      ],
    });

    const report = await getRetentionReport({ tenantId: fixture.tenantId } as ActionCtx);

    expect(report.history).toBe("sufficient");
    // The cohort: active, not deleted, joined on or before the period
    // start. The member who joined 3 days ago is NOT in it.
    expect(report.eligibleMemberCount).toBe(4);
    // Only the unmarked member has no record.
    expect(report.row.memberCountAtRisk).toBe(1);
    expect(report.row.membersWithZeroLast30).toBe(1);
    // Present, late and absent are all records.
    expect(report.row.membersWithPartialLast30).toBe(3);
    expect(report.row.totalActiveMembers).toBe(5);
    // The aggregate shape is pinned by the protected tier1 test: four
    // numbers, never a per-member list. (That test cannot run in this
    // environment because its own fixture fails on an audit foreign
    // key — a pre-existing failure — so the shape is guarded here.)
    expect(Object.keys(report.row).sort()).toEqual([
      "memberCountAtRisk",
      "membersWithPartialLast30",
      "membersWithZeroLast30",
      "totalActiveMembers",
    ]);
  });

  it("does not treat a member with an unknown join date as part of the cohort", async () => {
    const fixture = await seedTenant({
      members: [
        { key: "known", joinedOn: DAYS_AGO(200) },
        { key: "unknown", joinedOn: null },
      ],
      sessions: [
        { key: "s1", date: DAYS_AGO(2), startsAt: istInstant(DAYS_AGO(2), "07:00") },
      ],
      marks: [{ session: "s1", member: "known", status: "present" }],
    });

    const report = await getRetentionReport({ tenantId: fixture.tenantId } as ActionCtx);

    expect(report.eligibleMemberCount).toBe(1);
    expect(report.row.memberCountAtRisk).toBe(0);
    expect(report.row.totalActiveMembers).toBe(2);
  });

  it("keeps the legacy partial field on its own one-to-three-marks threshold", async () => {
    // The legacy `membersWithPartialLast30` field keeps its meaning: a
    // member with one to three qualifying marks. A member with FOUR
    // marks has records — so they are not in the "no records" count —
    // but four marks is not "partial" either. The factual with-record
    // count is derived from the cohort, never from this field.
    const fixture = await seedTenant({
      members: [
        { key: "fourMarks", joinedOn: DAYS_AGO(200) },
        { key: "threeMarks", joinedOn: DAYS_AGO(200) },
      ],
      sessions: [0, 1, 2, 3, 4].map((i) => ({
        key: `s${i}`,
        date: DAYS_AGO(10 - i),
        startsAt: istInstant(DAYS_AGO(10 - i), "07:00"),
      })),
      marks: [
        { session: "s0", member: "fourMarks", status: "present" },
        { session: "s1", member: "fourMarks", status: "present" },
        { session: "s2", member: "fourMarks", status: "late" },
        { session: "s3", member: "fourMarks", status: "absent" },
        { session: "s4", member: "fourMarks", status: "present" },
        { session: "s0", member: "threeMarks", status: "present" },
        { session: "s1", member: "threeMarks", status: "present" },
        { session: "s2", member: "threeMarks", status: "present" },
      ],
    });

    const report = await getRetentionReport({ tenantId: fixture.tenantId } as ActionCtx);

    expect(report.eligibleMemberCount).toBe(2);
    // Both members have records, so neither is in the no-records count.
    expect(report.row.memberCountAtRisk).toBe(0);
    expect(report.row.membersWithZeroLast30).toBe(0);
    // Only the member with three marks is inside the legacy one-to-three
    // band; the member with four marks is not "partial".
    expect(report.row.membersWithPartialLast30).toBe(1);
  });
});

describe("attendance records to review — cancelled and not-yet-started sessions", () => {
  it("does not count a mark written against a cancelled session as a record", async () => {
    // Cancelling a session keeps its marks, but the session stops being
    // a chance to attend, so the mark is not a record of the period.
    const fixture = await seedTenant({
      members: [
        { key: "cancelledMark", joinedOn: DAYS_AGO(200) },
        { key: "unmarked", joinedOn: DAYS_AGO(200) },
      ],
      sessions: [
        {
          key: "cancelled",
          date: DAYS_AGO(2),
          startsAt: istInstant(DAYS_AGO(2), "07:00"),
          status: "cancelled",
        },
        { key: "ran", date: DAYS_AGO(2), startsAt: istInstant(DAYS_AGO(2), "18:00") },
      ],
      marks: [{ session: "cancelled", member: "cancelledMark", status: "present" }],
    });

    const report = await getRetentionReport({ tenantId: fixture.tenantId } as ActionCtx);

    expect(report.history).toBe("sufficient");
    expect(report.sessionsInWindow).toBe(1);
    expect(report.row.membersWithPartialLast30).toBe(0);
    expect(report.row.memberCountAtRisk).toBe(2);
  });

  it("reports insufficient history when the only session has not started yet", async () => {
    // A session later today is not history: no future record creates
    // retrospective history.
    const fixture = await seedTenant({
      members: [{ key: "m", joinedOn: DAYS_AGO(200) }],
      sessions: [
        {
          key: "laterToday",
          date: TODAY,
          startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
      ],
      marks: [{ session: "laterToday", member: "m", status: "present" }],
    });

    const report = await getRetentionReport({ tenantId: fixture.tenantId } as ActionCtx);

    expect(report.sessionsInWindow).toBe(0);
    expect(report.history).toBe("insufficient");
    expect(report.row.memberCountAtRisk).toBe(0);
  });

  it("does not let a mark on a session that has not started count as a record", async () => {
    // A session that ran AND a session later today. The later mark is
    // not a record, so its member still has no records to review.
    const fixture = await seedTenant({
      members: [
        { key: "ran", joinedOn: DAYS_AGO(200) },
        { key: "later", joinedOn: DAYS_AGO(200) },
      ],
      sessions: [
        { key: "ran", date: DAYS_AGO(2), startsAt: istInstant(DAYS_AGO(2), "07:00") },
        {
          key: "laterToday",
          date: TODAY,
          startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
      ],
      marks: [
        { session: "ran", member: "ran", status: "present" },
        { session: "laterToday", member: "later", status: "present" },
      ],
    });

    const report = await getRetentionReport({ tenantId: fixture.tenantId } as ActionCtx);

    expect(report.sessionsInWindow).toBe(1);
    expect(report.history).toBe("sufficient");
    expect(report.row.membersWithPartialLast30).toBe(1);
    expect(report.row.memberCountAtRisk).toBe(1);
  });
});

describe("attendance records to review — the period is the tenant's own last 30 days", () => {
  it("counts a session at local midnight on the first day of the period and ignores the day before it", async () => {
    // 30 calendar days including today starts at local midnight 29 days
    // ago. A session at 00:00 that day is inside the period; one at
    // 23:30 the day before is not — India's midnight is the edge that
    // a UTC-day window gets wrong.
    const fixture = await seedTenant({
      members: [
        { key: "firstDay", joinedOn: DAYS_AGO(200) },
        { key: "dayBefore", joinedOn: DAYS_AGO(200) },
      ],
      sessions: [
        {
          key: "atMidnight",
          date: DAYS_AGO(29),
          startsAt: istInstant(DAYS_AGO(29), "00:00"),
        },
        {
          key: "lateNightBefore",
          date: DAYS_AGO(30),
          startsAt: istInstant(DAYS_AGO(30), "23:30"),
        },
      ],
      marks: [
        { session: "atMidnight", member: "firstDay", status: "present" },
        { session: "lateNightBefore", member: "dayBefore", status: "present" },
      ],
    });

    const report = await getRetentionReport({ tenantId: fixture.tenantId } as ActionCtx);

    expect(report.row.membersWithPartialLast30).toBe(1);
    expect(report.row.memberCountAtRisk).toBe(1);
  });

  it("counts a session that started late on the first day of the period", async () => {
    const fixture = await seedTenant({
      members: [
        { key: "lateNight", joinedOn: DAYS_AGO(200) },
        { key: "unmarked", joinedOn: DAYS_AGO(200) },
      ],
      sessions: [
        {
          key: "lateNight",
          date: DAYS_AGO(29),
          startsAt: istInstant(DAYS_AGO(29), "23:30"),
        },
      ],
      marks: [{ session: "lateNight", member: "lateNight", status: "present" }],
    });

    const report = await getRetentionReport({ tenantId: fixture.tenantId } as ActionCtx);

    expect(report.row.membersWithPartialLast30).toBe(1);
    expect(report.row.memberCountAtRisk).toBe(1);
  });
});

describe("attendance records to review — tenant and location scope", () => {
  it("never sees another tenant's members or sessions", async () => {
    const other = await seedTenant({
      members: [{ key: "m", joinedOn: DAYS_AGO(200) }],
      sessions: [
        { key: "s1", date: DAYS_AGO(2), startsAt: istInstant(DAYS_AGO(2), "07:00") },
      ],
      marks: [{ session: "s1", member: "m", status: "present" }],
    });
    const mine = await seedTenant({
      members: [{ key: "m", joinedOn: DAYS_AGO(200) }],
    });

    const myReport = await getRetentionReport({ tenantId: mine.tenantId } as ActionCtx);
    expect(myReport.eligibleMemberCount).toBe(1);
    expect(myReport.sessionsInWindow).toBe(0);
    expect(myReport.history).toBe("insufficient");
    expect(myReport.row.memberCountAtRisk).toBe(0);

    const theirReport = await getRetentionReport({ tenantId: other.tenantId } as ActionCtx);
    expect(theirReport.eligibleMemberCount).toBe(1);
    expect(theirReport.sessionsInWindow).toBe(1);
    expect(theirReport.row.memberCountAtRisk).toBe(0);
  });

  it("counts only the caller's own locations", async () => {
    const fixture = await seedTenant({
      locationScoped: true,
      members: [
        { key: "atA", joinedOn: DAYS_AGO(200), location: "a" },
        { key: "atB", joinedOn: DAYS_AGO(200), location: "b" },
      ],
      sessions: [
        { key: "sA", date: DAYS_AGO(2), startsAt: istInstant(DAYS_AGO(2), "07:00"), location: "a" },
        { key: "sB", date: DAYS_AGO(2), startsAt: istInstant(DAYS_AGO(2), "18:00"), location: "b" },
      ],
      marks: [{ session: "sB", member: "atB", status: "present" }],
    });
    const userId = asUserId(randomUUID());

    const atA = await getRetentionReport({
      tenantId: fixture.tenantId,
      userId,
      allLocations: false,
      locationIds: [fixture.locations.a],
    } as ActionCtx);
    expect(atA.eligibleMemberCount).toBe(1);
    expect(atA.row.totalActiveMembers).toBe(1);
    expect(atA.row.membersWithPartialLast30).toBe(0);
    expect(atA.row.memberCountAtRisk).toBe(1);

    const atB = await getRetentionReport({
      tenantId: fixture.tenantId,
      userId,
      allLocations: false,
      locationIds: [fixture.locations.b],
    } as ActionCtx);
    expect(atB.eligibleMemberCount).toBe(1);
    expect(atB.row.totalActiveMembers).toBe(1);
    expect(atB.row.membersWithPartialLast30).toBe(1);
    expect(atB.row.memberCountAtRisk).toBe(0);

    const everywhere = await getRetentionReport({
      tenantId: fixture.tenantId,
      userId,
      allLocations: true,
      locationIds: [],
    } as ActionCtx);
    expect(everywhere.eligibleMemberCount).toBe(2);
    expect(everywhere.row.totalActiveMembers).toBe(2);
    expect(everywhere.row.memberCountAtRisk).toBe(1);
  });
});
