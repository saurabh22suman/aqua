import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
// The privileged pool is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only. Every assertion below runs against the application's own
// service, which connects as `app_login` under tenant RLS.
import { asTenantId, asUserId } from "@/lib/ids";
import { withTenant } from "@/db/tenant";
import { persons } from "@/db/schema/people";
import { staff } from "@/db/schema/staff";

// DEF-08 — the leave balance must not be overdrawn by two requests.
//
// `requestLeave` reads the caller's balance (approved + pending days)
// and then inserts the request. Nothing serialises the two steps, so
// two concurrent requests can BOTH read the same balance, both pass the
// quota check and both insert — the balance ends up overdrawn.
//
// The lock has to be on a stable parent row that always exists for the
// caller: the STAFF row. Locking the leave rows themselves cannot close
// the race, because a staff member with no leave rows yet has nothing
// to lock.
//
// The test widens the read-to-insert window deterministically with a
// fixture trigger (a sleep on INSERT) and asserts the COMMITTED
// outcome.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const actor = asUserId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7(), roleKey: "worker" };

let leave: typeof import("@/lib/services/leave");

let leaveTypeId = "";

async function requestRows(): Promise<{ id: string; status: string; days: string }[]> {
  const { rows } = await admin.query<{ id: string; status: string; days: string }>(
    "select id, status, days from leave_requests where tenant_id = $1 order by created_at",
    [tenant],
  );
  return rows;
}

beforeAll(async () => {
  leave = await import("@/lib/services/leave");

  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9192${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Leave Race', 'active', $3)",
    [tenant, `d-leave-${RUN}`, TZ],
  );
  await withTenant(tenant, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ tenantId: tenant, fullName: `Leave Worker ${RUN}`, dateOfBirth: "1990-01-01" })
      .returning({ id: persons.id });
    await tx.insert(staff).values({
      tenantId: tenant,
      personId: person!.id,
      userId: actor,
      staffType: "worker",
    });
  });
  const created = await leave.createLeaveType(ctx, {
    name: "Single Day",
    annualQuota: 1,
    isPaid: false,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("leave type fixture failed");
  leaveTypeId = created.leaveTypeId;
}, 60_000);

afterAll(async () => {
  await admin.query("drop trigger if exists d_workflows_leave_slow on leave_requests");
  await admin.query("drop function if exists d_workflows_leave_slow()");
  await admin.query("delete from leave_requests where tenant_id = $1", [tenant]);
  await admin.query("delete from leave_types where tenant_id = $1", [tenant]);
  await admin.query("delete from staff where tenant_id = $1", [tenant]);
  await admin.query("delete from persons where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("DEF-08 leave balance race", () => {
  it("refuses the second of two concurrent requests that would overdraw the balance", async () => {
    await admin.query("delete from leave_requests where tenant_id = $1", [tenant]);

    // Fixture: widen the read-to-insert window so both transactions
    // read the same balance before either insert commits.
    await admin.query(
      `create or replace function d_workflows_leave_slow() returns trigger
       language plpgsql as $$ begin perform pg_sleep(0.2); return new; end $$`,
    );
    await admin.query(
      `create trigger d_workflows_leave_slow
       before insert on leave_requests for each row execute function d_workflows_leave_slow()`,
    );
    try {
      const results = await Promise.all([
        leave.requestLeave(ctx, { leaveTypeId, fromDate: "2026-11-02", toDate: "2026-11-02" }),
        leave.requestLeave(ctx, { leaveTypeId, fromDate: "2026-11-03", toDate: "2026-11-03" }),
      ]);
      const ok = results.filter((r) => r.ok);
      expect(ok.length).toBe(1);
      const refused = results.filter((r) => !r.ok);
      expect(refused.length).toBe(1);
      if (refused[0] && !refused[0].ok) {
        expect(refused[0].error).toMatch(/left this year/);
      }
    } finally {
      await admin.query("drop trigger if exists d_workflows_leave_slow on leave_requests");
      await admin.query("drop function if exists d_workflows_leave_slow()");
    }

    const rows = await requestRows();
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("pending");
  }, 30_000);

  it("keeps the balance honest when requests are made one after another", async () => {
    await admin.query("delete from leave_requests where tenant_id = $1", [tenant]);

    const first = await leave.requestLeave(ctx, {
      leaveTypeId,
      fromDate: "2026-12-01",
      toDate: "2026-12-01",
    });
    expect(first.ok).toBe(true);

    const second = await leave.requestLeave(ctx, {
      leaveTypeId,
      fromDate: "2026-12-02",
      toDate: "2026-12-02",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/left this year/);

    expect((await requestRows()).length).toBe(1);
  });
});
