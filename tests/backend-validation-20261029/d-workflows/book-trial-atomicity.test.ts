import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
// The privileged pool is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only. Every assertion below runs against the application's own
// services, which connect as `app_login` under tenant RLS.
import { asTenantId, asUserId } from "@/lib/ids";
import { withTenant } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import { enrolments } from "@/db/schema/scheduling";

// DEF-02 — booking a trial is ONE atomic business operation.
//
// The trial booking creates a member (person, guardian, guardianship,
// consent grants), enrols that member in the trial batch and links the
// enquiry. It used to run as three separate transactions and discarded
// the enrolment result, so:
//
//   * booking a trial into a FULL batch reported success -- the member
//     existed, the enquiry was marked trial_scheduled, and the member was
//     never on the batch's roster;
//   * a failure after the member was created left an orphan trial member
//     that the enquiry did not link, and the retry created a SECOND
//     member.
//
// The acceptance below pins the atomic contract: on a failed downstream
// step NOTHING is left behind (member, person, guardian, consent,
// enrolment, enquiry link, audit rows), and a legitimate booking still
// commits all of it -- including under concurrency.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const locationId = uuidv7();
const programId = uuidv7();
const fullBatchId = uuidv7();
const openBatchId = uuidv7();
const actor = asUserId(uuidv7());

let enquiries: typeof import("@/lib/services/enquiries");

type Counts = {
  members: number;
  persons: number;
  consents: number;
  guardianships: number;
  enrolments: number;
  audits: number;
};

async function counts(): Promise<Counts> {
  const one = async (sql: string) => {
    const { rows } = await admin.query<{ n: string }>(sql, [tenant]);
    return Number(rows[0]?.n ?? 0);
  };
  return {
    members: await one("select count(*)::text as n from members where tenant_id = $1"),
    persons: await one("select count(*)::text as n from persons where tenant_id = $1"),
    consents: await one("select count(*)::text as n from consents where tenant_id = $1"),
    guardianships: await one("select count(*)::text as n from guardianships where tenant_id = $1"),
    enrolments: await one("select count(*)::text as n from enrolments where tenant_id = $1"),
    audits: await one("select count(*)::text as n from audit_log where tenant_id = $1"),
  };
}

async function enquiryRow(id: string): Promise<{ stage: string; member_id: string | null } | undefined> {
  const { rows } = await admin.query<{ stage: string; member_id: string | null }>(
    "select stage, member_id from enquiries where id = $1 and tenant_id = $2",
    [id, tenant],
  );
  return rows[0];
}

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7(), roleKey: "owner" };

function details(dob = "1990-01-01") {
  return {
    dateOfBirth: dob,
    locationId,
    consents: [
      { purpose: "processing" as const, policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
    ],
  };
}

beforeAll(async () => {
  enquiries = await import("@/lib/services/enquiries");

  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9195${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Trial Atomic', 'active', $3)",
    [tenant, `d-trial-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Trial Hall', true)",
    [locationId, tenant],
  );
  await admin.query("insert into programs (id, tenant_id, name) values ($1, $2, 'Trial Program')", [
    programId,
    tenant,
  ]);
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id)
     values ($1, $3, $4, 'Full Batch', 1, '{1}', '07:00', '08:00', $5),
            ($2, $3, $4, 'Open Batch', 10, '{2}', '09:00', '10:00', $5)`,
    [fullBatchId, openBatchId, tenant, programId, locationId],
  );
  // The full batch already holds its one place.
  await withTenant(tenant, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ tenantId: tenant, fullName: "Existing Member", dateOfBirth: "1990-01-01" })
      .returning({ id: persons.id });
    const [member] = await tx
      .insert(members)
      .values({
        tenantId: tenant,
        personId: person!.id,
        locationId,
        memberCode: `FULL-${RUN}`,
        status: "active",
      })
      .returning({ id: members.id });
    await tx.insert(enrolments).values({
      tenantId: tenant,
      memberId: member!.id,
      batchId: fullBatchId,
      enrolledOn: "2026-10-01",
    });
  });
}, 60_000);

afterAll(async () => {
  // audit_log is append-only (a trigger refuses DELETE), so the audit
  // rows stay in the disposable database — the same shape as the other
  // tenant-scoped suites.
  await admin.query("delete from enquiry_follow_ups where tenant_id = $1", [tenant]);
  await admin.query("delete from enquiries where tenant_id = $1", [tenant]);
  await admin.query("delete from consents where tenant_id = $1", [tenant]);
  await admin.query("delete from guardianships where tenant_id = $1", [tenant]);
  await admin.query("delete from enrolments where tenant_id = $1", [tenant]);
  await admin.query("delete from members where tenant_id = $1", [tenant]);
  await admin.query("delete from persons where tenant_id = $1", [tenant]);
  await admin.query("delete from batches where tenant_id = $1", [tenant]);
  await admin.query("delete from programs where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("DEF-02 trial booking atomicity", () => {
  it("refuses a trial into a full batch and leaves NOTHING behind", async () => {
    const enquiry = await enquiries.createEnquiry(ctx, {
      fullName: "Full Batch Trial",
      source: "walk-in",
      locationId,
    });
    const before = await counts();

    const result = await enquiries.bookTrial(ctx, {
      enquiryId: enquiry.id,
      batchId: fullBatchId,
      details: details(),
    });

    expect(result.ok).toBe(false);

    const after = await counts();
    expect(after.members).toBe(before.members);
    expect(after.persons).toBe(before.persons);
    expect(after.consents).toBe(before.consents);
    expect(after.guardianships).toBe(before.guardianships);
    expect(after.enrolments).toBe(before.enrolments);
    expect(after.audits).toBe(before.audits);

    const row = await enquiryRow(enquiry.id);
    expect(row?.stage).toBe("new");
    expect(row?.member_id).toBeNull();
  });

  it("commits the member, the enrolment, the enquiry link and the audit rows together", async () => {
    const enquiry = await enquiries.createEnquiry(ctx, {
      fullName: "Good Trial",
      source: "walk-in",
      locationId,
    });
    const before = await counts();

    const result = await enquiries.bookTrial(ctx, {
      enquiryId: enquiry.id,
      batchId: openBatchId,
      details: details(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await counts();
    expect(after.members).toBe(before.members + 1);
    expect(after.persons).toBe(before.persons + 1);
    expect(after.consents).toBe(before.consents + 1);
    expect(after.enrolments).toBe(before.enrolments + 1);
    // member.create + member.enrol + enquiry.trial_book
    expect(after.audits).toBe(before.audits + 3);

    const row = await enquiryRow(enquiry.id);
    expect(row?.stage).toBe("trial_scheduled");
    expect(row?.member_id).toBe(result.memberId);

    const { rows: memberRows } = await admin.query<{ status: string }>(
      "select status from members where id = $1",
      [result.memberId],
    );
    expect(memberRows[0]?.status).toBe("trial");

    const { rows: auditRows } = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1 and action in ('member.create','member.enrol','enquiry.trial_book')",
      [tenant],
    );
    expect(auditRows.map((r) => r.action).sort()).toEqual([
      "enquiry.trial_book",
      "member.create",
      "member.enrol",
    ]);
  });

  it("books a trial only ONCE when two bookings race on the same enquiry", async () => {
    const enquiry = await enquiries.createEnquiry(ctx, {
      fullName: "Racing Trial",
      source: "walk-in",
      locationId,
    });
    const before = await counts();

    const [first, second] = await Promise.all([
      enquiries.bookTrial(ctx, {
        enquiryId: enquiry.id,
        batchId: openBatchId,
        details: details(),
      }),
      enquiries.bookTrial(ctx, {
        enquiryId: enquiry.id,
        batchId: openBatchId,
        details: details(),
      }),
    ]);

    const results = [first, second];
    const winners = results.filter((r) => r.ok);
    expect(winners.length).toBe(1);
    expect(results.filter((r) => !r.ok).length).toBe(1);

    const after = await counts();
    expect(after.members).toBe(before.members + 1);
    expect(after.persons).toBe(before.persons + 1);
    expect(after.enrolments).toBe(before.enrolments + 1);

    const row = await enquiryRow(enquiry.id);
    expect(row?.member_id).toBe(winners[0]?.ok ? winners[0].memberId : null);
  });

  it("rolls the whole booking back when the enquiry update fails", async () => {
    const enquiry = await enquiries.createEnquiry(ctx, {
      fullName: "Broken Update Trial",
      source: "walk-in",
      locationId,
    });
    const before = await counts();

    // A fixture trigger that fails the enquiry UPDATE: the booking's
    // last step. Everything before it must roll back with it.
    await admin.query(
      `create or replace function d_workflows_fail_enquiry_update() returns trigger
       language plpgsql as $$ begin
         if new.id = '${enquiry.id}' then
           raise exception 'fixture: enquiry update refused';
         end if;
         return new;
       end $$`,
    );
    await admin.query(
      `create trigger d_workflows_enquiry_update_guard
       before update on enquiries for each row execute function d_workflows_fail_enquiry_update()`,
    );
    try {
      await expect(
        enquiries.bookTrial(ctx, {
          enquiryId: enquiry.id,
          batchId: openBatchId,
          details: details(),
        }),
      ).rejects.toThrow();
    } finally {
      await admin.query("drop trigger if exists d_workflows_enquiry_update_guard on enquiries");
      await admin.query("drop function if exists d_workflows_fail_enquiry_update()");
    }

    const after = await counts();
    expect(after.members).toBe(before.members);
    expect(after.persons).toBe(before.persons);
    expect(after.consents).toBe(before.consents);
    expect(after.enrolments).toBe(before.enrolments);
    expect(after.audits).toBe(before.audits);

    const row = await enquiryRow(enquiry.id);
    expect(row?.stage).toBe("new");
    expect(row?.member_id).toBeNull();
  });

  it("still refuses a second booking on an enquiry that already has a member", async () => {
    const enquiry = await enquiries.createEnquiry(ctx, {
      fullName: "Second Booking",
      source: "walk-in",
      locationId,
    });
    const first = await enquiries.bookTrial(ctx, {
      enquiryId: enquiry.id,
      batchId: openBatchId,
      details: details(),
    });
    expect(first.ok).toBe(true);

    const second = await enquiries.bookTrial(ctx, {
      enquiryId: enquiry.id,
      batchId: openBatchId,
      details: details(),
    });
    expect(second.ok).toBe(false);
  });
});
