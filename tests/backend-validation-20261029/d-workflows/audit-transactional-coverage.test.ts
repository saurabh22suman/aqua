import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
// The privileged pool is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only. Every assertion below runs against the application's own
// services, which connect as `app_login` under tenant RLS.
import { asTenantId, asUserId } from "@/lib/ids";

// DEF-03 / DEF-04 — the tenant audit trail.
//
// Requirement (docs/architecture.md:1330, CLAUDE.md:62): "Written for
// every mutation, in the same transaction as the change."
//
// Two families were missing or incomplete:
//
//   * DEF-03 — four mutation families wrote NO audit row at all:
//     programmes/batches, the holiday calendar, the waitlist and staff
//     creation. A refusal or a no-op must NOT be audited, so the
//     assertions below check both directions: the write is recorded, and
//     the refusal records nothing.
//   * DEF-04 — three families wrote their audit row through a LOCAL
//     writer (activities, membership plans, facility opt-ins) that
//     omitted actor_type, source, request_id and changed_fields, and
//     skipped the row entirely for an identity-free caller. The one
//     writer (lib/audit/write.ts) applies the actor model in one place
//     (lib/audit/write.ts:5-12) and architecture.md:1783 requires a
//     request_id on every audit row.
//
// The last case proves the atomicity rule: when the audit write fails,
// the mutation does not persist.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const locationId = uuidv7();
const actor = asUserId(uuidv7());
const requestId = uuidv7();

const ctx = { tenantId: tenant, userId: actor, requestId, roleKey: "owner" };

let programs: typeof import("@/lib/services/programs");
let holidays: typeof import("@/lib/services/holidays");
let waitlist: typeof import("@/lib/services/waitlist");
let staff: typeof import("@/lib/services/staff");
let activities: typeof import("@/lib/services/activities");
let plans: typeof import("@/lib/services/membership-plans");
let optins: typeof import("@/lib/services/facility-optins");

type AuditRow = {
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_type: string;
  actor_id: string | null;
  request_id: string | null;
};

async function auditRows(action: string): Promise<AuditRow[]> {
  const { rows } = await admin.query<AuditRow>(
    "select action, entity_type, entity_id, actor_type, actor_id, request_id from audit_log where tenant_id = $1 and action = $2 order by created_at",
    [tenant, action],
  );
  return rows;
}

async function countRows(table: string, where = "tenant_id = $1"): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    `select count(*)::text as n from ${table} where ${where}`,
    [tenant],
  );
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  programs = await import("@/lib/services/programs");
  holidays = await import("@/lib/services/holidays");
  waitlist = await import("@/lib/services/waitlist");
  staff = await import("@/lib/services/staff");
  activities = await import("@/lib/services/activities");
  plans = await import("@/lib/services/membership-plans");
  optins = await import("@/lib/services/facility-optins");

  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Audit Trail', 'active', $3)",
    [tenant, `d-audit-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Audit Hall', true)",
    [locationId, tenant],
  );
}, 60_000);

afterAll(async () => {
  // audit_log is append-only (a trigger refuses DELETE), so the audit
  // rows stay in the disposable database.
  await admin.query("delete from waitlist_entries where tenant_id = $1", [tenant]);
  await admin.query("delete from member_facility_optins where tenant_id = $1", [tenant]);
  await admin.query("delete from membership_plans where tenant_id = $1", [tenant]);
  await admin.query("delete from facilities where tenant_id = $1", [tenant]);
  await admin.query("delete from attendance where tenant_id = $1", [tenant]);
  await admin.query("delete from sessions where tenant_id = $1", [tenant]);
  await admin.query("delete from staff where tenant_id = $1", [tenant]);
  await admin.query("delete from enrolments where tenant_id = $1", [tenant]);
  await admin.query("delete from members where tenant_id = $1", [tenant]);
  await admin.query("delete from persons where tenant_id = $1", [tenant]);
  await admin.query("delete from batches where tenant_id = $1", [tenant]);
  await admin.query("delete from programs where tenant_id = $1", [tenant]);
  await admin.query("delete from tenant_holidays where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("DEF-03 programme and batch mutations are audited", () => {
  it("records the create, the update and the delete of a programme", async () => {
    const program = await programs.createProgram(ctx, { name: "Swimming" });

    const created = await auditRows("program.create");
    expect(created.length).toBe(1);
    expect(created[0]?.entity_type).toBe("program");
    expect(created[0]?.entity_id).toBe(program.id);
    expect(created[0]?.actor_type).toBe("user");
    expect(created[0]?.actor_id).toBe(actor);
    expect(created[0]?.request_id).toBe(requestId);

    await programs.updateProgram(ctx, { programId: program.id, name: "Swimming Plus" });
    const updated = await auditRows("program.update");
    expect(updated.length).toBe(1);
    expect(updated[0]?.entity_id).toBe(program.id);

    await programs.deleteProgram(ctx, program.id);
    const deleted = await auditRows("program.delete");
    expect(deleted.length).toBe(1);
    expect(deleted[0]?.entity_id).toBe(program.id);
  });

  it("records nothing when a programme delete is refused", async () => {
    const program = await programs.createProgram(ctx, { name: "Busy Programme" });
    await programs.createBatch(ctx, {
      programId: program.id,
      name: "Busy Batch",
      capacity: 5,
      daysOfWeek: [1],
      startTime: "07:00",
      endTime: "08:00",
      locationId,
    });
    const before = (await auditRows("program.delete")).length;

    const result = await programs.deleteProgram(ctx, program.id);
    expect(result.ok).toBe(false);
    expect((await auditRows("program.delete")).length).toBe(before);
  });

  it("records the create, the update and the delete of a batch", async () => {
    const program = await programs.createProgram(ctx, { name: "Programme For Batches" });
    const batch = await programs.createBatch(ctx, {
      programId: program.id,
      name: "Evening Batch",
      capacity: 8,
      daysOfWeek: [2, 4],
      startTime: "17:00",
      endTime: "18:00",
      locationId,
    });

    const created = await auditRows("batch.create");
    const forThisBatch = created.filter((r) => r.entity_id === batch.id);
    expect(forThisBatch.length).toBe(1);
    expect(forThisBatch[0]?.entity_type).toBe("batch");
    expect(forThisBatch[0]?.request_id).toBe(requestId);

    await programs.updateBatch(ctx, {
      batchId: batch.id,
      programId: program.id,
      name: "Evening Batch v2",
      capacity: 9,
      daysOfWeek: [2, 4],
      startTime: "17:00",
      endTime: "18:00",
      locationId,
    });
    const updated = await auditRows("batch.update");
    expect(updated.length).toBe(1);
    expect(updated[0]?.entity_id).toBe(batch.id);

    await programs.deleteBatch(ctx, batch.id);
    const deleted = await auditRows("batch.delete");
    expect(deleted.length).toBe(1);
    expect(deleted[0]?.entity_id).toBe(batch.id);
  });
});

describe("DEF-03 holiday calendar mutations are audited", () => {
  it("records the add and the remove of a holiday", async () => {
    const added = await holidays.addHoliday(ctx, {
      name: "Republic Day",
      holidayDate: "2026-01-26",
      recurringYearly: true,
    });
    expect(added.kind).toBe("ok");
    if (added.kind !== "ok") return;

    const created = await auditRows("holiday.add");
    expect(created.length).toBe(1);
    expect(created[0]?.entity_id).toBe(added.holidayId);
    expect(created[0]?.actor_type).toBe("user");
    expect(created[0]?.request_id).toBe(requestId);

    const removed0 = await holidays.removeHoliday(ctx, { holidayId: added.holidayId });
    expect(removed0.kind).toBe("ok");
    const removed = await auditRows("holiday.remove");
    expect(removed.length).toBe(1);
    expect(removed[0]?.entity_id).toBe(added.holidayId);
  });

  it("records nothing when a duplicate holiday is refused", async () => {
    await holidays.addHoliday(ctx, { name: "Diwali", holidayDate: "2026-11-08" });
    const before = (await auditRows("holiday.add")).length;
    const duplicate = await holidays.addHoliday(ctx, { name: "Diwali", holidayDate: "2026-11-08" });
    expect(duplicate.kind).toBe("error");
    expect((await auditRows("holiday.add")).length).toBe(before);
  });
});

describe("DEF-03 waitlist mutations are audited", () => {
  it("records the add, the cancel and the promotion", async () => {
    const program = await programs.createProgram(ctx, { name: "Waitlist Programme" });
    const batch = await programs.createBatch(ctx, {
      programId: program.id,
      name: "Waitlist Batch",
      capacity: 5,
      daysOfWeek: [3],
      startTime: "07:00",
      endTime: "08:00",
      locationId,
    });
    const { withTenant } = await import("@/db/tenant");
    const { members, persons } = await import("@/db/schema/people");
    const memberId = await withTenant(tenant, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ tenantId: tenant, fullName: "Waitlist Member", dateOfBirth: "1990-01-01" })
        .returning({ id: persons.id });
      const [member] = await tx
        .insert(members)
        .values({
          tenantId: tenant,
          personId: person!.id,
          locationId,
          memberCode: `WL-${RUN}`,
          status: "active",
        })
        .returning({ id: members.id });
      return member!.id;
    });

    const added = await waitlist.addToWaitlist(ctx, { memberId, batchId: batch.id });
    expect(added.kind).toBe("ok");
    if (added.kind !== "ok") return;
    const created = await auditRows("waitlist.add");
    expect(created.length).toBe(1);
    expect(created[0]?.entity_id).toBe(added.entryId);
    expect(created[0]?.request_id).toBe(requestId);

    const cancelled = await waitlist.cancelWaitlist(ctx, { memberId, batchId: batch.id });
    expect(cancelled.kind).toBe("ok");
    const removed = await auditRows("waitlist.cancel");
    expect(removed.length).toBe(1);
    expect(removed[0]?.entity_id).toBe(added.entryId);

    // Promotion of an EMPTY queue is a refusal: nothing is audited.
    const beforePromote = (await auditRows("waitlist.promote")).length;
    const promote = await waitlist.promoteHead(ctx, { batchId: batch.id });
    expect(promote.kind).toBe("error");
    expect((await auditRows("waitlist.promote")).length).toBe(beforePromote);
  });
});

describe("DEF-03 staff creation is audited", () => {
  it("records the staff record a caller creates", async () => {
    const result = await staff.createStaff(ctx, {
      fullName: `Audited Coach ${RUN}`,
      staffType: "coach",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const created = await auditRows("staff.create");
    expect(created.length).toBe(1);
    expect(created[0]?.entity_type).toBe("staff");
    expect(created[0]?.entity_id).toBe(result.staffId);
    expect(created[0]?.actor_type).toBe("user");
    expect(created[0]?.request_id).toBe(requestId);
  });
});

describe("DEF-04 the one audit writer attributes every row", () => {
  it("attributes an activity write to its actor and request", async () => {
    const result = await activities.createActivity(ctx, {
      locationId,
      name: `Pool ${RUN}`,
      kind: "pool",
      capacity: 4,
    });
    expect(result.ok).toBe(true);

    const rows = await auditRows("activity.create");
    expect(rows.length).toBe(1);
    expect(rows[0]?.actor_type).toBe("user");
    expect(rows[0]?.actor_id).toBe(actor);
    expect(rows[0]?.request_id).toBe(requestId);
  });

  it("attributes a membership plan write to its actor and request", async () => {
    const result = await plans.createPlan(ctx, {
      locationId,
      name: `Term Plan ${RUN}`,
      kind: "term",
      durationDays: 30,
      amountPaise: 50_000,
    });
    expect(result.ok).toBe(true);

    const rows = await auditRows("membership_plan.create");
    expect(rows.length).toBe(1);
    expect(rows[0]?.actor_type).toBe("user");
    expect(rows[0]?.actor_id).toBe(actor);
    expect(rows[0]?.request_id).toBe(requestId);
  });

  it("attributes a facility opt-in write to its actor and request", async () => {
    const { withTenant } = await import("@/db/tenant");
    const { members, persons } = await import("@/db/schema/people");
    const memberId = await withTenant(tenant, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ tenantId: tenant, fullName: "Optin Member", dateOfBirth: "1990-01-01" })
        .returning({ id: persons.id });
      const [member] = await tx
        .insert(members)
        .values({
          tenantId: tenant,
          personId: person!.id,
          locationId,
          memberCode: `OPT-${RUN}`,
          status: "active",
        })
        .returning({ id: members.id });
      return member!.id;
    });

    const result = await optins.addMemberFacility(ctx, { memberId, locationId });
    expect(result.ok).toBe(true);

    const rows = await auditRows("member_facility.add");
    expect(rows.length).toBe(1);
    expect(rows[0]?.actor_type).toBe("user");
    expect(rows[0]?.actor_id).toBe(actor);
    expect(rows[0]?.request_id).toBe(requestId);
  });
});

describe("the audit row and the mutation share one transaction", () => {
  it("does not persist the mutation when the audit write fails", async () => {
    const program = await programs.createProgram(ctx, { name: "Rollback Programme" });
    const batchesBefore = await countRows("batches");

    await admin.query(
      `create or replace function d_workflows_fail_batch_audit() returns trigger
       language plpgsql as $$ begin
         if new.action = 'batch.create' then
           raise exception 'fixture: audit write refused';
         end if;
         return new;
       end $$`,
    );
    await admin.query(
      `create trigger d_workflows_batch_audit_guard
       before insert on audit_log for each row execute function d_workflows_fail_batch_audit()`,
    );
    try {
      await expect(
        programs.createBatch(ctx, {
          programId: program.id,
          name: "Never Persisted",
          capacity: 5,
          daysOfWeek: [5],
          startTime: "07:00",
          endTime: "08:00",
          locationId,
        }),
      ).rejects.toThrow();
    } finally {
      await admin.query("drop trigger if exists d_workflows_batch_audit_guard on audit_log");
      await admin.query("drop function if exists d_workflows_fail_batch_audit()");
    }

    expect(await countRows("batches")).toBe(batchesBefore);
  });
});
