import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
// The privileged pool is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only. Every assertion below runs against the application's own
// service, which connects as `app_login` under tenant RLS.
import { asTenantId, asUserId } from "@/lib/ids";
import { withTenant } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import { enrolments } from "@/db/schema/scheduling";

// DEF-09 — a transfer must not create a SECOND live enrolment row in
// the destination batch.
//
// The unique key of `enrolments` is (tenant, member, batch,
// enrolled_on) — db/schema/scheduling.ts:36 — so a member enrolled in
// the destination batch on an EARLIER date can be enrolled there again
// on another date. The transfer's duplicate check only looked for a
// destination enrolment dated TODAY, so a member who was already
// enrolled in the destination batch moved into it a second time.
//
// The refusal the code already has is the right one —
// `already_enrolled_in_target` — it just was not applied to the rows it
// should have been applied to.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const locationId = uuidv7();
const programId = uuidv7();
const sourceBatchId = uuidv7();
const destinationBatchId = uuidv7();
let memberId = uuidv7();
const actor = asUserId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7(), roleKey: "owner" };

let transfer: typeof import("@/lib/services/transfer");

async function enrolmentRows(): Promise<{ id: string; batch_id: string; enrolled_on: string }[]> {
  const { rows } = await admin.query<{ id: string; batch_id: string; enrolled_on: string }>(
    "select id, batch_id, enrolled_on from enrolments where tenant_id = $1 order by enrolled_on",
    [tenant],
  );
  return rows;
}

beforeAll(async () => {
  transfer = await import("@/lib/services/transfer");

  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9191${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Transfer Scope', 'active', $3)",
    [tenant, `d-transfer-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Transfer Hall', true)",
    [locationId, tenant],
  );
  await admin.query("insert into programs (id, tenant_id, name) values ($1, $2, 'Transfer Program')", [
    programId,
    tenant,
  ]);
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id)
     values ($1, $3, $4, 'Source Batch', 10, '{1}', '07:00', '08:00', $5),
            ($2, $3, $4, 'Destination Batch', 10, '{2}', '09:00', '10:00', $5)`,
    [sourceBatchId, destinationBatchId, tenant, programId, locationId],
  );
  await withTenant(tenant, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ tenantId: tenant, fullName: `Transfer Member ${RUN}`, dateOfBirth: "1990-01-01" })
      .returning({ id: persons.id });
    const [member] = await tx
      .insert(members)
      .values({
        tenantId: tenant,
        personId: person!.id,
        locationId,
        memberCode: `T-${RUN}`,
        status: "active",
      })
      .returning({ id: members.id });
    memberId = member!.id;
  });
}, 60_000);

afterAll(async () => {
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

describe("DEF-09 batch transfer duplicate destination enrolment", () => {
  it("refuses a transfer into a batch the member is already enrolled in", async () => {
    await admin.query("delete from enrolments where tenant_id = $1", [tenant]);
    await withTenant(tenant, async (tx) => {
      // Enrolled in the source batch today AND in the destination batch
      // on an earlier date.
      await tx.insert(enrolments).values({
        tenantId: tenant,
        memberId: memberId as never,
        batchId: sourceBatchId,
        enrolledOn: "2026-10-29",
      });
      await tx.insert(enrolments).values({
        tenantId: tenant,
        memberId: memberId as never,
        batchId: destinationBatchId,
        enrolledOn: "2026-10-01",
      });
    });

    const result = await transfer.transferMemberToBatch(ctx, {
      memberId,
      fromBatchId: sourceBatchId,
      toBatchId: destinationBatchId,
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("already_enrolled_in_target");
    }

    // The refusal is not destructive: the source enrolment survives.
    const rows = await enrolmentRows();
    expect(rows.length).toBe(2);
    expect(rows.some((r) => r.batch_id === sourceBatchId)).toBe(true);
    expect(rows.filter((r) => r.batch_id === destinationBatchId).length).toBe(1);
  });

  it("still transfers a member who is not in the destination batch", async () => {
    await admin.query("delete from enrolments where tenant_id = $1", [tenant]);
    await withTenant(tenant, async (tx) => {
      await tx.insert(enrolments).values({
        tenantId: tenant,
        memberId: memberId as never,
        batchId: sourceBatchId,
        enrolledOn: "2026-10-29",
      });
    });

    const result = await transfer.transferMemberToBatch(ctx, {
      memberId,
      fromBatchId: sourceBatchId,
      toBatchId: destinationBatchId,
    });
    expect(result.kind).toBe("ok");

    const rows = await enrolmentRows();
    expect(rows.length).toBe(1);
    expect(rows[0]?.batch_id).toBe(destinationBatchId);
  });
});
