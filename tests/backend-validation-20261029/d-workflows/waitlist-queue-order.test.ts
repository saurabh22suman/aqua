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

// DEF-06 — the waitlist queue order.
//
// `addToWaitlist` computes the next position as
// coalesce(max(position), 0) + 1 over the batch's waiting rows and then
// inserts. Nothing serialises the two steps, and the schema has NO
// unique index on (batch, position) — the unique index that exists is
// on (tenant, member, batch) where status = 'waiting', which stops a
// DOUBLE ADD but not two DIFFERENT members landing on the same
// position.
//
// Locking the existing waitlist rows cannot close this race: when the
// queue is EMPTY there is nothing to lock. The lock has to be on a
// stable parent row that always exists — the batch — so the whole queue
// for a batch is serialised.
//
// The test widens the read-to-insert window deterministically with a
// fixture trigger (a sleep on INSERT), so both transactions read the
// same empty queue before either insert commits. The outcome asserted
// is a COMMITTED one: distinct positions and a deterministic head.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const locationId = uuidv7();
const programId = uuidv7();
const batchId = uuidv7();
const actor = asUserId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7(), roleKey: "owner" };

let waitlist: typeof import("@/lib/services/waitlist");

let memberSeq = 0;

async function memberIds(count: number): Promise<string[]> {
  return withTenant(tenant, async (tx) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const seq = memberSeq++;
      const [person] = await tx
        .insert(persons)
        .values({ tenantId: tenant, fullName: `Queue Member ${seq}`, dateOfBirth: "1990-01-01" })
        .returning({ id: persons.id });
      const [member] = await tx
        .insert(members)
        .values({
          tenantId: tenant,
          personId: person!.id,
          locationId,
          memberCode: `Q-${RUN}-${seq}`,
          status: "active",
        })
        .returning({ id: members.id });
      ids.push(member!.id);
    }
    return ids;
  });
}

async function positions(): Promise<number[]> {
  const { rows } = await admin.query<{ position: number }>(
    "select position from waitlist_entries where tenant_id = $1 and batch_id = $2 and status = 'waiting' order by position",
    [tenant, batchId],
  );
  return rows.map((r) => r.position);
}

beforeAll(async () => {
  waitlist = await import("@/lib/services/waitlist");

  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9193${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Queue Order', 'active', $3)",
    [tenant, `d-queue-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Queue Hall', true)",
    [locationId, tenant],
  );
  await admin.query("insert into programs (id, tenant_id, name) values ($1, $2, 'Queue Program')", [
    programId,
    tenant,
  ]);
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id)
     values ($1, $2, $3, 'Queue Batch', 10, '{1}', '07:00', '08:00', $4)`,
    [batchId, tenant, programId, locationId],
  );
}, 60_000);

afterAll(async () => {
  await admin.query("drop trigger if exists d_workflows_queue_slow on waitlist_entries");
  await admin.query("drop function if exists d_workflows_queue_slow()");
  await admin.query("delete from waitlist_entries where tenant_id = $1", [tenant]);
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

describe("DEF-06 waitlist queue order", () => {
  it("gives two members joining an EMPTY queue distinct positions", async () => {
    await admin.query("delete from waitlist_entries where tenant_id = $1", [tenant]);
    const [a, b] = await memberIds(2);

    // Fixture: widen the read-to-insert window so both transactions
    // read the empty queue before either insert commits.
    await admin.query(
      `create or replace function d_workflows_queue_slow() returns trigger
       language plpgsql as $$ begin perform pg_sleep(0.2); return new; end $$`,
    );
    await admin.query(
      `create trigger d_workflows_queue_slow
       before insert on waitlist_entries for each row execute function d_workflows_queue_slow()`,
    );
    try {
      const results = await Promise.all([
        waitlist.addToWaitlist(ctx, { memberId: a, batchId }),
        waitlist.addToWaitlist(ctx, { memberId: b, batchId }),
      ]);
      expect(results.every((r) => r.kind === "ok")).toBe(true);
    } finally {
      await admin.query("drop trigger if exists d_workflows_queue_slow on waitlist_entries");
      await admin.query("drop function if exists d_workflows_queue_slow()");
    }

    const committed = await positions();
    expect(committed.length).toBe(2);
    expect([...committed].sort((x, y) => x - y)).toEqual([1, 2]);

    const head = await waitlist.getWaitlistHead(ctx, { batchId });
    expect(head).not.toBeNull();
    expect(head!.position).toBe(1);
  }, 30_000);

  it("keeps the queue ordered when eight members join at once", async () => {
    await admin.query("delete from waitlist_entries where tenant_id = $1", [tenant]);
    const ids = await memberIds(8);

    const results = await Promise.all(
      ids.map((memberId) => waitlist.addToWaitlist(ctx, { memberId, batchId })),
    );
    expect(results.filter((r) => r.kind === "ok").length).toBe(8);

    const committed = await positions();
    expect([...committed].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  }, 30_000);
});
