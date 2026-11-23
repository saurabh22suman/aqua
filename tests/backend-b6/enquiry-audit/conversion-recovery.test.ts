// @vitest-environment node

// Conversion must roll back together with its member and audit writes.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";
import type { IsolatedDb } from "@/tests/helpers/isolated-db";

let db: IsolatedDb;
let admin: import("pg").Pool;

type EnquiryModule = typeof import("@/lib/services/enquiries");
let enquiries: EnquiryModule;

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

async function auditCount(action: string, entityId?: string): Promise<number> {
  const { rows } = await admin.query<{ count: number }>(
    `select count(*)::int as count from audit_log
       where tenant_id=$1 and action=$2 and ($3::uuid is null or entity_id=$3)`,
    [tenantId, action, entityId ?? null],
  );
  return rows[0]!.count;
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

  // The live membership, not the caller's asserted role, determines access.
  // Keep reception restricted to A and the foreign owner in the other tenant.
  const ownerRole = randomUUID(), receptionRole = randomUUID(), foreignRole = randomUUID();
  const receptionMembership = randomUUID();
  await admin.query(
    `insert into roles(id,tenant_id,key,name,home_path,home_ordinal)
     values ($1,$4,'owner','Owner','/owner',0),
            ($2,$4,'receptionist','Reception','/reception',3),
            ($3,$5,'owner','Owner','/owner',0)`,
    [ownerRole, receptionRole, foreignRole, tenantId, otherTenantId],
  );
  await admin.query(
    `insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations)
     values ($1,$4,$6,$8,'active',true), ($2,$4,$7,$9,'active',false),
            ($3,$5,$6,$10,'active',true)`,
    [randomUUID(), receptionMembership, randomUUID(), tenantId, otherTenantId,
      managerUserId, receptionUserId, ownerRole, receptionRole, foreignRole],
  );
  await admin.query(
    "insert into membership_locations(id,tenant_id,membership_id,location_id) values($1,$2,$3,$4)",
    [randomUUID(), tenantId, receptionMembership, locationA],
  );

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

async function failNextConversion(enquiryId: string, run: () => Promise<unknown>) {
  await admin.query(`
    create function audit_test_interrupt_conversion() returns trigger language plpgsql
    as $body$
    begin
      if old.id::text = TG_ARGV[0] and new.stage = 'converted' then
        raise exception 'synthetic failure before enquiry links to member';
      end if;
      return new;
    end;
    $body$;
    create trigger audit_test_interrupt_conversion before update of stage on enquiries
      for each row execute function audit_test_interrupt_conversion('${enquiryId}');
  `);
  try {
    await expect(run()).rejects.toThrow();
  } finally {
    await admin.query(`
      drop trigger audit_test_interrupt_conversion on enquiries;
      drop function audit_test_interrupt_conversion();
    `);
  }
}

async function memberIds(fullName: string): Promise<string[]> {
  const { rows } = await admin.query<{ id: string }>(
    "select m.id from members m join persons p on p.id=m.person_id and p.tenant_id=m.tenant_id where m.tenant_id=$1 and p.full_name=$2",
    [tenantId, fullName],
  );
  return rows.map((row) => row.id);
}

async function enquiryState(enquiryId: string) {
  const { rows } = await admin.query<{ stage: string; member_id: string | null }>(
    "select stage, member_id from enquiries where tenant_id=$1 and id=$2", [tenantId, enquiryId],
  );
  return rows[0];
}

async function trialEnquiry(fullName: string) {
  const enquiry = await enquiries.createEnquiry(manager(), { fullName, source: "referral", locationId: locationA });
  const trial = await enquiries.bookTrial(manager(), { enquiryId: enquiry.id, batchId, details: newMemberDetails() });
  if (!trial.ok) throw new Error(trial.error);
  const stage = await enquiries.transitionEnquiryStage(manager(), { enquiryId: enquiry.id, toStage: "trial_completed" });
  if (!stage.ok) throw new Error(stage.error);
  return { enquiryId: enquiry.id, memberId: trial.memberId };
}

it("rolls back the minor, guardian, consent and audit before retrying the interrupted conversion", async () => {
  const fullName = "Synthetic Minor Retry";
  const guardianName = "Synthetic Guardian Retry";
  const { id } = await enquiries.createEnquiry(manager(), { fullName, source: "online", locationId: locationA });
  const input = {
    enquiryId: id,
    reason: "register now",
    newMember: {
      ...newMemberDetails(),
      dateOfBirth: "2018-06-15",
      guardian: { fullName: guardianName, relationship: "mother" },
    },
  };
  const readPeople = () => admin.query(
    "select full_name from persons where tenant_id=$1 and full_name=any($2::text[])",
    [tenantId, [fullName, guardianName]],
  );

  const startingMemberAudit = await auditCount("member.create");
  await failNextConversion(id, () => enquiries.convertEnquiry(manager(), input));
  expect(await enquiryState(id)).toEqual({ stage: "new", member_id: null });
  expect(await memberIds(fullName)).toEqual([]);
  expect((await readPeople()).rows).toEqual([]);
  expect(await auditCount("enquiry.convert", id)).toBe(0);
  expect(await auditCount("member.create")).toBe(startingMemberAudit);

  const result = await enquiries.convertEnquiry(manager(), input);
  if (!result.ok) throw new Error(result.error);
  expect(await enquiryState(id)).toEqual({ stage: "converted", member_id: result.memberId });
  expect(await memberIds(fullName)).toEqual([result.memberId]);
  expect((await readPeople()).rows).toHaveLength(2);
  const relationship = await admin.query(
    `select g.relationship, guardian.full_name as guardian, c.purpose from members m
       join guardianships g on g.tenant_id=m.tenant_id and g.minor_id=m.person_id
       join persons guardian on guardian.id=g.guardian_id
       join consents c on c.tenant_id=m.tenant_id and c.person_id=m.person_id and c.granted_by=guardian.id
       where m.tenant_id=$1 and m.id=$2`,
    [tenantId, result.memberId],
  );
  expect(relationship.rows).toEqual([{ relationship: "mother", guardian: guardianName, purpose: "processing" }]);
  expect(await auditCount("enquiry.convert", id)).toBe(1);
});

it("returns the original member and leaves the audit trail alone when the reply is lost", async () => {
  const fullName = "Synthetic Lost Conversion Reply";
  const { id } = await enquiries.createEnquiry(manager(), { fullName, source: "phone", locationId: locationA });
  const input = { enquiryId: id, reason: "register", newMember: newMemberDetails() };
  const first = await enquiries.convertEnquiry(reception(), input);
  if (!first.ok) throw new Error(first.error);
  expect(await enquiries.convertEnquiry(reception(), input)).toEqual(first);
  expect(await memberIds(fullName)).toEqual([first.memberId]);
  expect(await auditCount("enquiry.convert", id)).toBe(1);
  expect(await auditCount("member.create", first.memberId)).toBe(1);
});

it("returns one linked member to two concurrent confirmations", async () => {
  const fullName = "Synthetic Concurrent Confirmation";
  const { id } = await enquiries.createEnquiry(manager(), { fullName, source: "walk-in", locationId: locationA });
  const input = { enquiryId: id, reason: "register", newMember: newMemberDetails() };
  const [first, second] = await Promise.all([
    enquiries.convertEnquiry(manager(), input),
    enquiries.convertEnquiry(reception(), input),
  ]);
  if (!first.ok) throw new Error(first.error);
  expect(second).toEqual(first);
  expect(await memberIds(fullName)).toEqual([first.memberId]);
  expect(await enquiryState(id)).toEqual({ stage: "converted", member_id: first.memberId });
  expect(await auditCount("enquiry.convert", id)).toBe(1);
});

it("keeps an existing member in Trial if the enquiry save fails, then activates them once", async () => {
  const fullName = "Synthetic Trial Retry";
  const { enquiryId, memberId } = await trialEnquiry(fullName);
  const input = { enquiryId, reason: "continue membership" };

  await failNextConversion(enquiryId, () => enquiries.convertEnquiry(manager(), input));
  const afterFailure = await admin.query("select status from members where tenant_id=$1 and id=$2", [tenantId, memberId]);
  expect(afterFailure.rows).toEqual([{ status: "trial" }]);
  expect(await enquiryState(enquiryId)).toEqual({ stage: "trial_completed", member_id: memberId });
  expect(await auditCount("member.status", memberId)).toBe(0);

  expect(await enquiries.convertEnquiry(manager(), input)).toEqual({ ok: true, memberId });
  expect(await enquiries.convertEnquiry(manager(), input)).toEqual({ ok: true, memberId });
  expect(await memberIds(fullName)).toEqual([memberId]);
  expect(await auditCount("member.status", memberId)).toBe(1);
  expect(await auditCount("enquiry.convert", enquiryId)).toBe(1);
});

it("finishes a legacy trial conversion whose linked member is already active", async () => {
  const { enquiryId, memberId } = await trialEnquiry("Synthetic Legacy Active Trial");
  const { transitionMemberStatus } = await import("@/lib/services/member-status");
  expect(await transitionMemberStatus(manager(), { memberId, toStatus: "active", reason: "simulate old partial save" })).toEqual({ ok: true });
  expect(await enquiryState(enquiryId)).toEqual({ stage: "trial_completed", member_id: memberId });
  expect(await enquiries.convertEnquiry(manager(), { enquiryId, reason: "finish conversion" })).toEqual({ ok: true, memberId });
  expect(await enquiryState(enquiryId)).toEqual({ stage: "converted", member_id: memberId });
  expect(await auditCount("member.status", memberId)).toBe(1);
  expect(await auditCount("enquiry.convert", enquiryId)).toBe(1);
});

it("refuses a replay when the linked member or enquiry is outside the caller's scope", async () => {
  const { id } = await enquiries.createEnquiry(manager(), { fullName: "Synthetic Scoped Replay", source: "phone", locationId: locationA });
  const input = { enquiryId: id, reason: "register at B", newMember: { ...newMemberDetails(), locationId: locationB } };
  const result = await enquiries.convertEnquiry(manager(), input);
  if (!result.ok) throw new Error(result.error);
  const refused = { ok: false, error: "Enquiry not found." };
  expect(await enquiries.convertEnquiry(reception(), input)).toEqual(refused);
  expect(await enquiries.convertEnquiry(foreignManager(), input)).toEqual(refused);
  expect(await auditCount("enquiry.convert", id)).toBe(1);
});

it("retries only the failed member-code transaction when two different enquiries race", async () => {
  const names = ["Synthetic First Code Race", "Synthetic Second Code Race"];
  const leads = await Promise.all(names.map((fullName) => enquiries.createEnquiry(manager(), {
    fullName, source: "phone", locationId: locationA,
  })));
  const lock = await admin.connect();
  let conversions: Promise<PromiseSettledResult<Awaited<ReturnType<typeof enquiries.convertEnquiry>>>[]> | undefined;
  try {
    // The readers can choose the same next code. Both inserts have to
    // wait here before either can advance the member-code sequence.
    await lock.query("begin");
    await lock.query("lock table members in share mode");
    conversions = Promise.allSettled(leads.map(({ id }) => enquiries.convertEnquiry(manager(), {
      enquiryId: id, reason: "register", newMember: newMemberDetails(),
    })));
    await vi.waitFor(async () => {
      const { rows: [waiting] } = await admin.query<{ count: number }>(
        `select count(*)::int as count from pg_stat_activity
           where datname=current_database() and wait_event_type='Lock' and query ilike '%insert into "members"%'`,
      );
      expect(waiting?.count).toBe(2);
    }, { timeout: 3000, interval: 50 });
    await lock.query("commit");
  } finally {
    await lock.query("rollback");
    lock.release();
    await conversions;
  }
  const results = await conversions!;
  expect(results).toHaveLength(2);
  for (const [index, outcome] of results.entries()) {
    const name = names[index]!;
    if (outcome.status === "rejected") throw outcome.reason;
    const result = outcome.value;
    if (!result.ok) throw new Error(result.error);
    expect(await memberIds(name)).toEqual([result.memberId]);
    expect(await enquiryState(leads[index]!.id)).toEqual({ stage: "converted", member_id: result.memberId });
  }
});
