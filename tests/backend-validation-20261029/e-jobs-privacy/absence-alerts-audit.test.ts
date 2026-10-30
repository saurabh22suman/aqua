// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F5 — an absence alert is a mutation, so it must write its audit row
// in the SAME transaction, with the right actor, and must not spam
// audit rows on a no-op re-run.
//
// The gap: lib/services/absence-alerts.ts detectAbsenceAlerts() inserts
// absence_alerts rows with no writeAudit() call. The sibling system
// mutation, lib/jobs/subscriptions-expire-job.ts, writes one
// 'subscription.expire' row per expired subscription with
// actor_type='system' and source='job'; lib/services/invoice-issue.ts
// does the same for a job-issued invoice. CLAUDE.md: "Every mutation
// writes its audit row in the same transaction."
//
// This file asserts:
//   1. every alert that is newly written has exactly one audit row;
//   2. the actor is the system (or the human who asked), the source
//      and the request attribution are right;
//   3. a re-run that writes no alert writes no audit row;
//   4. when the audit write fails, the ALERT write rolls back with it.
//
// Each test seeds its own member, so the alert it inspects is always a
// NEWLY written one.
//
// Fixture setup/cleanup runs through the privileged fixture pool
// (tests/db/privileged-fixture.ts); every application call runs through
// the application's own path (app_login, RLS on).
//
// Agent-owned file.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";
import { privilegedFixturePool } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const { detectAbsenceAlerts } = await import("@/lib/services/absence-alerts");

const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const programId = uuidv7();
const batchId = uuidv7();

const humanUserId = uuidv7();
const requestId = uuidv7();

const TZ = "Asia/Kolkata";
const today = todayInZone(TZ);
const day = (n: number) => addDays(today, -n);

/** The batch's four past sessions — shared by every member in the batch. */
const sessionIds: string[] = [];

type AuditRow = {
  id: string;
  actor_type: string;
  actor_id: string | null;
  source: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
};

async function auditRowsFor(): Promise<AuditRow[]> {
  const rows = await privilegedFixturePool.query<AuditRow>(
    `select id::text, actor_type, actor_id::text, source, entity_type, entity_id::text, request_id::text
       from audit_log
      where tenant_id = $1::uuid and action = 'absence_alert.create'
      order by id`,
    [tenantId],
  );
  return rows.rows;
}

async function alertIdsFor(memberId: string): Promise<string[]> {
  const rows = await privilegedFixturePool.query<{ id: string }>(
    "select id::text from absence_alerts where tenant_id = $1::uuid and member_id = $2::uuid order by id",
    [tenantId, memberId],
  );
  return rows.rows.map((r) => r.id);
}

/** The member, its person and its enrolment — no attendance yet. */
async function seedMember(memberId: string, personId: string, tag: string): Promise<void> {
  await privilegedFixturePool.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, $3)",
    [personId, tenantId, `Child ${tag}`],
  );
  await privilegedFixturePool.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenantId, personId, locationId, `E-AUD-${tag}`],
  );
  await privilegedFixturePool.query(
    "insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on) values ($1, $2, $3, $4, current_date - 60)",
    [uuidv7(), tenantId, memberId, batchId],
  );
}

/** Three consecutive absences plus one present mark (so the monthly rule fires too). */
async function seedAbsences(memberId: string, tag: string): Promise<void> {
  const statuses = ["absent", "absent", "absent", "present"];
  for (let i = 1; i <= statuses.length; i++) {
    await privilegedFixturePool.query(
      "insert into attendance (id, tenant_id, session_id, member_id, status, client_id) values ($1, $2, $3, $4, $5, $6)",
      [uuidv7(), tenantId, sessionIds[i - 1]!, memberId, statuses[i - 1], `e-audit-${tag}-${i}-${RUN}`],
    );
  }
}

/**
 * Make the reset audit write fail AT THE DATABASE, for this fixture
 * only. The trigger is restricted to this tenant AND this action, so
 * no shared privilege is touched and no other lane's or test's audit
 * write is affected — the fault is injected at the row, not at the
 * role.
 */
async function armAuditFault(): Promise<void> {
  await privilegedFixturePool.query("drop trigger if exists e_absence_audit_fault on audit_log");
  await privilegedFixturePool.query("drop function if exists e_absence_audit_fault()");
  await privilegedFixturePool.query(`create function e_absence_audit_fault() returns trigger language plpgsql as $$ begin
      if new.tenant_id = '${tenantId}'::uuid and new.action = 'absence_alert.create' then
        raise exception 'e-jobs-privacy absence audit fault';
      end if;
      return new; end $$`);
  await privilegedFixturePool.query(
    "create trigger e_absence_audit_fault before insert on audit_log for each row execute function e_absence_audit_fault()",
  );
}

async function disarmAuditFault(): Promise<void> {
  await privilegedFixturePool.query("drop trigger if exists e_absence_audit_fault on audit_log");
  await privilegedFixturePool.query("drop function if exists e_absence_audit_fault()");
}

const memberA = uuidv7();
const personA = uuidv7();
const memberB = uuidv7();
const personB = uuidv7();
const memberC = uuidv7();
const personC = uuidv7();

beforeAll(async () => {
  await privilegedFixturePool.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'E Absence Audit', 'active', $3)",
    [tenantId, `e-audit-${RUN}`, TZ],
  );
  await privilegedFixturePool.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await privilegedFixturePool.query(
    "insert into users (id, phone) values ($1, $2)",
    [humanUserId, `+9199${String(Date.now()).slice(-8)}`],
  );
  await privilegedFixturePool.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Squash')",
    [programId, tenantId],
  );
  await privilegedFixturePool.query(
    "insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id) values ($1, $2, $3, 'Junior TTS', 20, '{0,1,2,3,4,5,6}', '07:00', '08:00', $4)",
    [batchId, tenantId, programId, locationId],
  );

  const statuses = ["absent", "absent", "absent", "present"];
  for (let i = 1; i <= statuses.length; i++) {
    const sessionId = uuidv7();
    sessionIds.push(sessionId);
    const dateIso = day(i);
    await privilegedFixturePool.query(
      "insert into sessions (id, tenant_id, batch_id, session_date, starts_at, ends_at, status) values ($1, $2, $3, $4, $5, $5, 'held')",
      [sessionId, tenantId, batchId, dateIso, `${dateIso}T02:30:00.000Z`],
    );
  }
});

afterAll(async () => {
  await disarmAuditFault();
  await deleteAuditRowsForTenant(privilegedFixturePool, tenantId);
  for (const table of [
    "absence_alerts",
    "attendance",
    "sessions",
    "enrolments",
    "members",
    "batches",
    "programs",
    "persons",
    "locations",
  ]) {
    await privilegedFixturePool.query(
      `delete from ${table} where tenant_id = $1::uuid`,
      [tenantId],
    );
  }
  await privilegedFixturePool.query("delete from tenants where id = $1::uuid", [tenantId]);
  await privilegedFixturePool.query("delete from users where id = $1::uuid", [humanUserId]);
  await privilegedFixturePool.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("F5 — every absence alert is audited in the same transaction", () => {
  it("writes one system audit row per newly created alert", async () => {
    await seedMember(memberA, personA, "A");
    await seedAbsences(memberA, "A");

    const result = await detectAbsenceAlerts({ tenantId });
    expect(result.inserted).toBeGreaterThan(0);

    const alerts = await alertIdsFor(memberA);
    expect(alerts.length).toBe(result.inserted);

    const audits = await auditRowsFor();
    expect(audits.length).toBe(result.inserted);

    for (const row of audits) {
      // A job has no human actor: actor_type 'system', actor_id NULL,
      // source 'job' — the same shape subscriptions.expire writes.
      expect(row.actor_type).toBe("system");
      expect(row.actor_id).toBeNull();
      expect(row.source).toBe("job");
      expect(row.entity_type).toBe("absence_alert");
      expect(row.entity_id).toBeTruthy();
      expect(alerts).toContain(row.entity_id);
      // A job carries no request id.
      expect(row.request_id).toBeNull();
    }
  });

  it("writes no duplicate audit rows when a re-run creates no alert", async () => {
    const before = (await auditRowsFor()).length;
    const again = await detectAbsenceAlerts({ tenantId });
    expect(again.inserted).toBe(0);
    expect((await auditRowsFor()).length).toBe(before);
  });

  it("attributes a human caller to that user and carries the request id", async () => {
    await seedMember(memberB, personB, "B");
    await seedAbsences(memberB, "B");

    const result = await detectAbsenceAlerts({
      tenantId,
      userId: asUserId(humanUserId),
      requestId,
    });
    expect(result.inserted).toBeGreaterThan(0);

    const memberBAlerts = await alertIdsFor(memberB);
    const rows = (await auditRowsFor()).filter(
      (row) => row.entity_id !== null && memberBAlerts.includes(row.entity_id),
    );
    expect(rows.length).toBe(result.inserted);
    for (const row of rows) {
      expect(row.actor_type).toBe("user");
      expect(row.actor_id).toBe(humanUserId);
      expect(row.source).toBe("web");
      expect(row.request_id).toBe(requestId);
    }
  });

  it("rolls the alert write back when the audit write fails", async () => {
    // The fault is injected with a trigger that fires only for THIS
    // tenant and THIS action (see armAuditFault), so the failure
    // happens on the application's own request path without touching
    // a shared privilege or any other tenant's audit write.
    await seedMember(memberC, personC, "C");
    await seedAbsences(memberC, "C");
    expect(await alertIdsFor(memberC)).toEqual([]);

    await armAuditFault();
    try {
      await expect(detectAbsenceAlerts({ tenantId })).rejects.toThrow();
    } finally {
      await disarmAuditFault();
    }

    // The alert insert and the audit insert share one transaction, so
    // neither survives.
    expect(await alertIdsFor(memberC)).toEqual([]);
  });
});
