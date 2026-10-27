// @vitest-environment node
//
// Backend batch 6 — the enquiry family's transactional audit trail.
//
// WHAT this proves: every enquiry mutation (capture, stage transition,
// follow-up create/complete, trial booking, conversion) writes its
// audit_log row through the ONE audit writer (lib/audit/write.ts) in
// the SAME transaction as the domain write, so a change can never
// succeed without its accountable record.
//
// WHY it is a real-database test: "the audit write is in the same
// transaction" is a claim about Postgres, not about a mock. Every
// assertion below runs against a real Postgres 16 with the real
// RLS, the real partitions and the real transaction — the fixture is
// the established tests/helpers/isolated-db Testcontainer (the same
// pattern tests/enquiry-service-characterization.test.ts uses), whose
// privileged pool is used for FIXTURE SETUP and fault injection only.
// The application path under test always goes through withTenant().
//
// This file is agent-owned (tests/backend-b6/**) and touches nothing
// under tests/tier1/**.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";
import type { IsolatedDb } from "@/tests/helpers/isolated-db";

let db: IsolatedDb;
let admin: import("pg").Pool;

type EnquiryModule = typeof import("@/lib/services/enquiries");
let enquiries: EnquiryModule;
let withTenant: typeof import("@/db/tenant").withTenant;

type AuditRow = {
  id: string;
  tenant_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: unknown;
  after_state: unknown;
  changed_fields: string[] | null;
  source: string;
  request_id: string | null;
};

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);

let tenantId: TenantId = asTenantId("");
let otherTenantId: TenantId = asTenantId("");
let locationA = "";
let locationB = "";
let batchId = "";

// An adult member's details: no guardian, one processing consent.
function newMemberDetails() {
  return {
    dateOfBirth: "1990-01-01",
    locationId: locationA,
    consents: [
      {
        purpose: "processing" as const,
        policyVersion: "2026.1",
        evidence: { channel: "staff-assisted-in-person" },
      },
    ],
  };
}

// A real users row: audit_log.actor_id references users(id), so an
// audit row can only name an actor that exists.
const managerUserId = asUserId(randomUUID());
const receptionUserId = asUserId(randomUUID());
const requestId = randomUUID();

// A management caller: every location, and the unresolved queue.
const manager = (userId: UserId = managerUserId) => ({
  tenantId,
  userId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set(["settings.manage", "enquiries.read", "enquiries.write"]),
  requestId,
});

// A location-scoped reception caller: only location A, and no
// settings.manage (so no unresolved queue).
const reception = (userId: UserId = receptionUserId) => ({
  tenantId,
  userId,
  roleKey: "receptionist",
  allLocations: false,
  locationIds: [locationA],
  permissions: new Set(["enquiries.read", "enquiries.write"]),
  requestId,
});

// A caller of the OTHER tenant. Nothing it does may touch this
// tenant's enquiries or its audit trail.
const foreignManager = (userId: UserId = managerUserId) => ({
  tenantId: otherTenantId,
  userId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set(["settings.manage", "enquiries.read", "enquiries.write"]),
  requestId,
});

async function insertLocation(tenant: TenantId, name: string, isPrimary: boolean) {
  const id = randomUUID();
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, $3, $4)",
    [id, tenant, name, isPrimary],
  );
  return id;
}

// The audit trail is read through the privileged pool so the assertion
// sees the row as STORED, including one a tenant-scoped read could
// not see. RLS isolation of the trail is asserted separately, through
// the application's own scoped read.
async function auditRows(filter: {
  tenantId?: string;
  entityId?: string;
  action?: string;
}): Promise<AuditRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.tenantId) {
    params.push(filter.tenantId);
    clauses.push(`tenant_id = $${params.length}`);
  }
  if (filter.entityId) {
    params.push(filter.entityId);
    clauses.push(`entity_id = $${params.length}`);
  }
  if (filter.action) {
    params.push(filter.action);
    clauses.push(`action = $${params.length}`);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const { rows } = await admin.query<AuditRow>(
    `select id, tenant_id, actor_type, actor_id, action, entity_type, entity_id,
            "before" as before_state, "after" as after_state, changed_fields, source, request_id
       from audit_log ${where} order by id`,
    params,
  );
  return rows;
}

beforeAll(async () => {
  // lib/env.ts parses process.env ONCE and db/client.ts builds its
  // pool from that parsed DATABASE_URL, so the module graph has to be
  // reset once the container's URL is in place.
  vi.resetModules();
  const { startIsolatedDb } = await import("@/tests/helpers/isolated-db");
  db = await startIsolatedDb();
  admin = db.admin;
  process.env.DATABASE_URL = db.appUri;
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  vi.resetModules();
  enquiries = await import("@/lib/services/enquiries");
  ({ withTenant } = await import("@/db/tenant"));

  tenantId = asTenantId(randomUUID());
  otherTenantId = asTenantId(randomUUID());
  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'Enquiry Audit', $3, 'active')",
    [tenantId, `enquiry-audit-${RUN}`, TZ],
  );
  await admin.query(
    "insert into tenants (id, slug, name, timezone, status) values ($1, $2, 'Other Audit Club', $3, 'active')",
    [otherTenantId, `enquiry-audit-other-${RUN}`, TZ],
  );
  locationA = await insertLocation(tenantId, "Audit A", true);
  locationB = await insertLocation(tenantId, "Audit B", false);

  // A real batch at location A, so a trial can be booked against it.
  const programId = randomUUID();
  batchId = randomUUID();
  await admin.query("insert into programs (id, tenant_id, name) values ($1, $2, 'Audit Program')", [
    programId,
    tenantId,
  ]);
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id)
     values ($1, $2, $3, 'Audit Trial Batch', 10, '{0,1,2,3,4,5,6}', '07:00', '08:00', $4)`,
    [batchId, tenantId, programId, locationA],
  );

  // The actor rows audit_log.actor_id points at.
  await admin.query("insert into users (id, phone) values ($1, $2), ($3, $4)", [
    managerUserId,
    "+919900000101",
    receptionUserId,
    "+919900000102",
  ]);

  // Location-scoped staff access ON, so a reception caller really is
  // confined to location A.
  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );
}, 180_000);

afterAll(async () => {
  const { pool } = await import("@/db/client");
  await pool.end();
  await db.stop();
}, 180_000);

describe("enquiry capture — audit", () => {
  it("writes exactly one enquiry.create audit row for the captured enquiry", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Walk-in",
      source: "walk-in",
      locationId: locationA,
    });

    const rows = await auditRows({ tenantId, entityId: created.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("enquiry.create");
    expect(rows[0].entity_type).toBe("enquiry");
    expect(rows[0].actor_id).toBe(managerUserId);
    expect(rows[0].actor_type).toBe("user");
    expect(rows[0].source).toBe("web");
    expect(rows[0].request_id).toBe(requestId);
  });
});

describe("enquiry stage transition — audit", () => {
  it("writes exactly one enquiry.stage audit row carrying the stage change", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Pipeline Subject",
      source: "phone",
      locationId: locationA,
    });
    await auditRows({ entityId: created.id });

    const moved = await enquiries.transitionEnquiryStage(manager(), {
      enquiryId: created.id,
      toStage: "contacted",
    });
    expect(moved).toEqual({ ok: true });

    const rows = await auditRows({ tenantId, entityId: created.id, action: "enquiry.stage" });
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_type).toBe("enquiry");
    expect(rows[0].before_state).toEqual({ stage: "new" });
    expect(rows[0].after_state).toEqual({ stage: "contacted" });
    expect(rows[0].changed_fields).toEqual(["stage"]);
    expect(rows[0].actor_id).toBe(managerUserId);
  });

  it("keeps the personal data of the enquiry out of the audit payload", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Privacy Subject",
      phone: "+919900000999",
      source: "walk-in",
      notes: "private note for the audit test",
      locationId: locationA,
    });

    const rows = await auditRows({ tenantId, entityId: created.id });
    const payload = JSON.stringify(rows.map((row) => [row.before_state, row.after_state]));
    expect(payload).not.toContain("Audit Privacy Subject");
    expect(payload).not.toContain("+919900000999");
    expect(payload).not.toContain("private note");
  });
});

describe("enquiry follow-up — audit", () => {
  it("writes exactly one enquiry.follow_up.create audit row for the new follow-up", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Follow Up Subject",
      source: "phone",
      locationId: locationA,
    });
    const dueAt = new Date("2026-11-01T10:00:00.000Z");

    const followUp = await enquiries.addFollowUp(manager(), {
      enquiryId: created.id,
      dueAt,
      note: "call back about the audit test",
    });

    const rows = await auditRows({ tenantId, entityId: followUp.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("enquiry.follow_up.create");
    expect(rows[0].entity_type).toBe("enquiry_follow_up");
    expect(rows[0].after_state).toEqual({
      enquiryId: created.id,
      dueAt: dueAt.toISOString(),
    });
    // The follow-up note is free text written about a person — it is
    // not copied into the trail.
    expect(JSON.stringify(rows[0].after_state)).not.toContain("call back");
  });

  it("writes exactly one enquiry.follow_up.complete audit row when a follow-up is completed", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Completion Subject",
      source: "phone",
      locationId: locationA,
    });
    const followUp = await enquiries.addFollowUp(manager(), {
      enquiryId: created.id,
      dueAt: new Date("2026-11-01T10:00:00.000Z"),
    });

    const completed = await enquiries.completeFollowUp(manager(), followUp.id);
    expect(completed).toEqual({ ok: true });

    const rows = await auditRows({
      tenantId,
      entityId: followUp.id,
      action: "enquiry.follow_up.complete",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_type).toBe("enquiry_follow_up");
    expect(rows[0].before_state).toEqual({ doneAt: null });
    expect(rows[0].changed_fields).toEqual(["doneAt"]);
    expect(typeof (rows[0].after_state as { doneAt: string }).doneAt).toBe("string");
  });

  it("writes no second audit row when an already-completed follow-up is completed again", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Repeat Completion Subject",
      source: "phone",
      locationId: locationA,
    });
    const followUp = await enquiries.addFollowUp(manager(), {
      enquiryId: created.id,
      dueAt: new Date("2026-11-01T10:00:00.000Z"),
    });

    await enquiries.completeFollowUp(manager(), followUp.id);
    const again = await enquiries.completeFollowUp(manager(), followUp.id);
    // The caller-visible result is unchanged: the follow-up is done.
    expect(again).toEqual({ ok: true });

    const rows = await auditRows({
      tenantId,
      entityId: followUp.id,
      action: "enquiry.follow_up.complete",
    });
    expect(rows).toHaveLength(1);

    // The completion is not re-stamped either: the recorded moment of
    // completion is the first one, not the repeat.
    const stored = await admin.query<{ done_at: Date }>(
      "select done_at from enquiry_follow_ups where id = $1",
      [followUp.id],
    );
    const recorded = (rows[0].after_state as { doneAt: string }).doneAt;
    expect(stored.rows[0].done_at.toISOString()).toBe(recorded);
  });
});

describe("enquiry trial booking — audit", () => {
  it("writes exactly one enquiry.trial_book audit row without duplicating the member's own audit", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Trial Subject",
      source: "walk-in",
      locationId: locationA,
    });

    const booked = await enquiries.bookTrial(manager(), {
      enquiryId: created.id,
      batchId,
      details: newMemberDetails(),
    });
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;

    const enquiryRows = await auditRows({ tenantId, entityId: created.id });
    const trialRows = enquiryRows.filter((row) => row.action === "enquiry.trial_book");
    expect(trialRows).toHaveLength(1);
    expect(trialRows[0].entity_type).toBe("enquiry");
    expect(trialRows[0].before_state).toEqual({
      stage: "new",
      memberId: null,
      trialBatchId: null,
      locationId: locationA,
    });
    expect(trialRows[0].after_state).toEqual({
      stage: "trial_scheduled",
      memberId: booked.memberId,
      trialBatchId: batchId,
      locationId: locationA,
    });
    expect(trialRows[0].changed_fields).toEqual(["stage", "memberId", "trialBatchId"]);

    // The member's own creation keeps its own audit row: the trial
    // booking does not duplicate it.
    const memberRows = await auditRows({ tenantId, entityId: booked.memberId });
    expect(memberRows.filter((row) => row.action === "member.create")).toHaveLength(1);
  });
});

describe("enquiry conversion — audit", () => {
  it("writes exactly one enquiry.convert audit row when the enquiry converts on its trial member", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Convert Via Trial Subject",
      source: "referral",
      locationId: locationA,
    });
    const booked = await enquiries.bookTrial(manager(), {
      enquiryId: created.id,
      batchId,
      details: newMemberDetails(),
    });
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;
    await enquiries.transitionEnquiryStage(manager(), {
      enquiryId: created.id,
      toStage: "trial_completed",
    });

    const converted = await enquiries.convertEnquiry(manager(), {
      enquiryId: created.id,
      reason: "loved the trial",
    });
    expect(converted.ok).toBe(true);

    const rows = await auditRows({ tenantId, entityId: created.id, action: "enquiry.convert" });
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_type).toBe("enquiry");
    expect(rows[0].before_state).toEqual({
      stage: "trial_completed",
      memberId: booked.memberId,
      trialBatchId: batchId,
      locationId: locationA,
    });
    expect(rows[0].after_state).toEqual({
      stage: "converted",
      memberId: booked.memberId,
      trialBatchId: batchId,
      locationId: locationA,
    });
    expect(rows[0].changed_fields).toEqual(["stage"]);

    // The member's status change keeps its own audit row.
    const memberRows = await auditRows({ tenantId, entityId: booked.memberId });
    expect(memberRows.filter((row) => row.action === "member.status")).toHaveLength(1);
  });

  it("writes exactly one enquiry.convert audit row when the enquiry converts without a trial", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Direct Convert Subject",
      source: "online",
      locationId: locationA,
    });

    const converted = await enquiries.convertEnquiry(manager(), {
      enquiryId: created.id,
      reason: "sibling of an existing member",
      newMember: newMemberDetails(),
    });
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;

    const rows = await auditRows({ tenantId, entityId: created.id, action: "enquiry.convert" });
    expect(rows).toHaveLength(1);
    expect(rows[0].before_state).toEqual({
      stage: "new",
      memberId: null,
      trialBatchId: null,
      locationId: locationA,
    });
    expect(rows[0].after_state).toEqual({
      stage: "converted",
      memberId: converted.memberId,
      trialBatchId: null,
      locationId: locationA,
    });
    expect(rows[0].changed_fields).toEqual(["stage", "memberId"]);
  });
});

describe("enquiry audit — refusals write nothing", () => {
  it("writes neither a stage change nor an audit row for a transition outside the allowed graph", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Illegal Transition Subject",
      source: "phone",
      locationId: locationA,
    });
    const before = await auditRows({ tenantId, entityId: created.id });

    const result = await enquiries.transitionEnquiryStage(manager(), {
      enquiryId: created.id,
      toStage: "trial_completed",
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/cannot move an enquiry/i);

    // No domain write ...
    const stored = await admin.query<{ stage: string }>(
      "select stage from enquiries where id = $1",
      [created.id],
    );
    expect(stored.rows[0].stage).toBe("new");
    // ... and no audit row.
    const after = await auditRows({ tenantId, entityId: created.id });
    expect(after).toHaveLength(before.length);
    expect(after.some((row) => row.action === "enquiry.stage")).toBe(false);
  });

  it("writes nothing when a caller of another tenant reaches for this tenant's enquiry", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Cross Tenant Subject",
      source: "phone",
      locationId: locationA,
    });
    const before = await auditRows({ tenantId, entityId: created.id });

    const result = await enquiries.transitionEnquiryStage(foreignManager(), {
      enquiryId: created.id,
      toStage: "contacted",
    });
    expect(result).toEqual({ ok: false, error: "Enquiry not found." });

    const stored = await admin.query<{ stage: string }>(
      "select stage from enquiries where id = $1",
      [created.id],
    );
    expect(stored.rows[0].stage).toBe("new");
    const after = await auditRows({ tenantId, entityId: created.id });
    expect(after).toHaveLength(before.length);
  });

  it("writes neither an enquiry nor an audit row for a capture outside the caller's locations", async () => {
    await expect(
      enquiries.createEnquiry(reception(), {
        fullName: "Audit Wrong Site Subject",
        source: "walk-in",
        locationId: locationB,
      }),
    ).rejects.toThrow(/location you have access to/i);

    const stored = await admin.query<{ n: number }>(
      "select count(*)::int as n from enquiries where full_name = $1",
      ["Audit Wrong Site Subject"],
    );
    expect(stored.rows[0].n).toBe(0);
    const rows = await auditRows({ tenantId, action: "enquiry.create" });
    expect(rows.some((row) => JSON.stringify(row.after_state).includes("Audit Wrong Site Subject"))).toBe(
      false,
    );
  });

  it("writes neither a follow-up nor an audit row for an enquiry the caller cannot see", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Hidden Enquiry Subject",
      source: "phone",
      locationId: locationB,
    });
    const before = await auditRows({ tenantId, entityId: created.id });

    await expect(
      enquiries.addFollowUp(reception(), {
        enquiryId: created.id,
        dueAt: new Date("2026-11-01T10:00:00.000Z"),
      }),
    ).rejects.toThrow(/enquiry not found/i);

    const stored = await admin.query<{ n: number }>(
      "select count(*)::int as n from enquiry_follow_ups where enquiry_id = $1",
      [created.id],
    );
    expect(stored.rows[0].n).toBe(0);
    const after = await auditRows({ tenantId, entityId: created.id });
    expect(after).toHaveLength(before.length);
  });

  it("keeps the audit trail inside the tenant that wrote it", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Trail Scope Subject",
      source: "phone",
      locationId: locationA,
    });

    // The application's own scoped read sees this tenant's row ...
    const own = await withTenant(tenantId, async (tx) => {
      const { auditLog } = await import("@/db/schema/audit");
      const { and, eq } = await import("drizzle-orm");
      return tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityId, created.id)));
    });
    expect(own.length).toBeGreaterThan(0);

    // ... and the other tenant's scoped read sees NONE of it.
    const foreign = await withTenant(otherTenantId, async (tx) => {
      const { auditLog } = await import("@/db/schema/audit");
      const { and, eq } = await import("drizzle-orm");
      return tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, otherTenantId), eq(auditLog.entityId, created.id)));
    });
    expect(foreign).toHaveLength(0);
  });
});

describe("enquiry audit — same-transaction atomicity", () => {
  it("rolls the stage change back when the audit row cannot be written", async () => {
    const created = await enquiries.createEnquiry(manager(), {
      fullName: "Audit Atomicity Subject",
      source: "phone",
      locationId: locationA,
    });
    const before = await auditRows({ tenantId, entityId: created.id });

    // Fault injection, in the disposable container only: a BEFORE
    // INSERT trigger on audit_log makes the audit write fail the way a
    // broken or full audit table would. If the audit write were in a
    // SEPARATE transaction, the stage change would survive it.
    await admin.query(`
      create or replace function b6_fail_audit_insert() returns trigger
      language plpgsql as $$
      begin
        raise exception 'aqua-b6: injected audit insert failure';
      end $$;
    `);
    await admin.query(
      "create trigger b6_audit_insert_failure before insert on public.audit_log for each row execute function b6_fail_audit_insert()",
    );

    try {
      // The audit write fails, so the whole mutation fails with it.
      const failure = await enquiries
        .transitionEnquiryStage(manager(), {
          enquiryId: created.id,
          toStage: "contacted",
        })
        .then(
          () => null,
          (err: unknown) =>
            err as { message?: string; cause?: { message?: string } },
        );
      expect(failure, "the transition must fail with the audit write").not.toBeNull();
      expect(String(failure?.message)).toMatch(/audit_log/);
      expect(String(failure?.cause?.message ?? "")).toMatch(
        /injected audit insert failure/i,
      );

      // The domain write rolled back with the failed audit write.
      const stored = await admin.query<{ stage: string }>(
        "select stage from enquiries where id = $1",
        [created.id],
      );
      expect(stored.rows[0].stage).toBe("new");

      const after = await auditRows({ tenantId, entityId: created.id });
      expect(after).toHaveLength(before.length);
      expect(after.some((row) => row.action === "enquiry.stage")).toBe(false);
    } finally {
      await admin.query("drop trigger if exists b6_audit_insert_failure on public.audit_log");
      await admin.query("drop function if exists b6_fail_audit_insert()");
    }

    // With the fault removed the same change succeeds and is recorded.
    const moved = await enquiries.transitionEnquiryStage(manager(), {
      enquiryId: created.id,
      toStage: "contacted",
    });
    expect(moved).toEqual({ ok: true });
    const recorded = await auditRows({
      tenantId,
      entityId: created.id,
      action: "enquiry.stage",
    });
    expect(recorded).toHaveLength(1);
  });
});
