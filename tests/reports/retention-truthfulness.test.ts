// @vitest-environment node
//
// Retention must not claim risk it cannot support.
//
// The owner UX audit (2026-10-24) found a freshly seeded club whose
// Reports page said all eight swimmers were "at risk" — with no
// attendance history at all, and nothing on Home to say otherwise.
//
// "At risk" is a claim about someone NOT doing something they had
// every chance to do, so it needs two facts:
//
//   1. there was a chance — attendance-eligible sessions ran in the
//      last 30 days; and
//   2. the member was around — they joined on or before the window
//      started. A swimmer who joined yesterday had no chance to
//      attend a session that happened before they joined.
//
// Without either fact the view reports insufficient history rather
// than a number.
//
// The database is a throwaway Postgres 16 (tests/helpers/isolated-db)
// with the real migrations, so the SQL predicates are exercised as
// they ship.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { IsolatedDb } from "@/tests/helpers/isolated-db";
import type { ActionCtx } from "@/lib/auth/context";
import type { RetentionReport } from "@/lib/services/owner-reports";
import type { TenantId } from "@/lib/ids";

let db: IsolatedDb;
const seededTenants: string[] = [];

const DAY = 24 * 60 * 60 * 1000;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
}

async function seedTenant(options: {
  memberJoinedDaysAgo: number;
  sessionsInWindow: number;
  attendanceFor: "none" | "the member";
}): Promise<TenantId> {
  const tenantId = randomUUID();
  const locationId = randomUUID();
  const personId = randomUUID();
  const memberId = randomUUID();
  const programId = randomUUID();
  const batchId = randomUUID();
  const sessionId = randomUUID();
  seededTenants.push(tenantId);

  await db.admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'Retention Test', 'active')",
    [tenantId, `retention-${tenantId}`],
  );
  await db.admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Test', true)",
    [locationId, tenantId],
  );
  await db.admin.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'Swimmer', '2014-01-01')",
    [personId, tenantId],
  );
  await db.admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on)
     values ($1, $2, $3, $4, $5, 'active', $6)`,
    [memberId, tenantId, personId, locationId, `RET-${memberId.slice(0, 6)}`, isoDaysAgo(options.memberJoinedDaysAgo)],
  );
  await db.admin.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Learn to swim')",
    [programId, tenantId],
  );
  await db.admin.query(
    `insert into batches (id, tenant_id, program_id, location_id, name, capacity, start_time, end_time)
     values ($1, $2, $3, $4, 'Batch', 10, '07:00', '08:00')`,
    [batchId, tenantId, programId, locationId],
  );
  for (let i = 0; i < options.sessionsInWindow; i++) {
    const date = isoDaysAgo(i + 1);
    // The first session carries the id the attendance row points at
    // (the composite FK is (session_id, tenant_id)).
    const id = i === 0 ? sessionId : randomUUID();
    await db.admin.query(
      `insert into sessions (id, tenant_id, batch_id, location_id, session_date, starts_at, ends_at, status)
       values ($1, $2, $3, $4, $5, $5::date + time '07:00', $5::date + time '08:00', 'scheduled')`,
      [id, tenantId, batchId, locationId, date],
    );
    if (options.attendanceFor === "the member" && i === 0) {
      await db.admin.query(
        `insert into attendance (id, tenant_id, session_id, member_id, location_id, status, client_id)
         values ($1, $2, $3, $4, $5, 'present', $6)`,
        [randomUUID(), tenantId, sessionId, memberId, locationId, randomUUID()],
      );
    }
  }
  return tenantId as TenantId;
}

// The service reads the app pool, which is built from DATABASE_URL
// at import time — so the URL must be in place before the module
// graph loads, and the module is imported ONCE (a reset would orphan
// the pool that holds the connection).
type RetentionFn = (ctx: ActionCtx) => Promise<RetentionReport>;
let getRetentionReport: RetentionFn;

async function retentionFor(tenantId: TenantId) {
  return getRetentionReport({ tenantId } as ActionCtx);
}

beforeAll(async () => {
  // lib/env.ts parses process.env ONCE, and db/client.ts builds its
  // pool from that parsed DATABASE_URL. The isolated database's URL is
  // only known after the container starts, so the module graph has to
  // be reset once the URL is in place — otherwise the app pool stays
  // pointed at whatever the ambient environment said, and every
  // tenant-scoped read returns ZERO ROWS (the contract in db/CLAUDE.md)
  // instead of failing loudly.
  vi.resetModules();
  const { startIsolatedDb } = await import("@/tests/helpers/isolated-db");
  db = await startIsolatedDb();
  process.env.DATABASE_URL = db.appUri;
  // The isolated database's app_login password (lib/env.ts refuses to
  // boot when APP_LOGIN_PASSWORD and the URL disagree).
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  vi.resetModules();
  ({ getRetentionReport } = await import("@/lib/services/owner-reports"));
}, 180_000);

afterAll(async () => {
  // The app pool holds a connection to the container; close it before
  // the container goes, or the driver reports the teardown as an
  // unhandled error and the shard exits non-zero.
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
    await db.admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await db.stop();
});

describe("retention view — only claims risk it can support", () => {
  it("reports insufficient history when no session ran in the window", async () => {
    // A club with nothing scheduled cannot have a retention problem.
    const tenantId = await seedTenant({
      memberJoinedDaysAgo: 200,
      sessionsInWindow: 0,
      attendanceFor: "none",
    });
    const row = await retentionFor(tenantId);
    expect(row.history).toBe("insufficient");
    expect(row.row.memberCountAtRisk).toBe(0);
    expect(row.sessionsInWindow).toBe(0);
  });

  it("reports insufficient history when no member was around for the window", async () => {
    // The seeded-club case: the swimmers joined today, so they have
    // had no chance to attend anything. Calling them at risk was the
    // false alarm the audit found.
    const tenantId = await seedTenant({
      memberJoinedDaysAgo: 0,
      sessionsInWindow: 3,
      attendanceFor: "none",
    });
    const row = await retentionFor(tenantId);
    expect(row.history).toBe("insufficient");
    expect(row.eligibleMemberCount).toBe(0);
    expect(row.row.memberCountAtRisk).toBe(0);
  });

  it("claims risk only for a member who was around and did not attend", async () => {
    const tenantId = await seedTenant({
      memberJoinedDaysAgo: 200,
      sessionsInWindow: 3,
      attendanceFor: "none",
    });
    const row = await retentionFor(tenantId);
    expect(row.history).toBe("sufficient");
    expect(row.eligibleMemberCount).toBe(1);
    expect(row.row.memberCountAtRisk).toBe(1);
  });

  it("does not claim risk for a member who did attend", async () => {
    const tenantId = await seedTenant({
      memberJoinedDaysAgo: 200,
      sessionsInWindow: 2,
      attendanceFor: "the member",
    });
    const row = await retentionFor(tenantId);
    expect(row.history).toBe("sufficient");
    expect(row.row.memberCountAtRisk).toBe(0);
  });
});
