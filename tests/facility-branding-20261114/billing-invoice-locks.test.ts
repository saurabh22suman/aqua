import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "@/tests/db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { createInvoiceForSubscription } from "@/lib/services/invoice-mutations";
import { runInvoicesGenerateJob } from "@/lib/jobs/invoices-generate-job";

const tenantId = asTenantId(uuidv7()), userId = asUserId(uuidv7());
const roleId = uuidv7(), locationId = uuidv7(), personId = uuidv7(), memberId = uuidv7(), planId = uuidv7(), subscriptionId = uuidv7();
beforeAll(async () => {
  await admin.query("insert into tenants(id,slug,name,status) values($1,$2,'Lock test','active')", [tenantId, `lock-${tenantId}`]);
  await admin.query("insert into users(id,phone) values($1,$2)", [userId, `+91${String(BigInt(`0x${userId.replaceAll('-', '').slice(-10)}`) % 10000000000n).padStart(10, '0')}`]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'owner','Owner','/owner',0)", [roleId, tenantId]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)", [uuidv7(), tenantId, userId, roleId]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Main',true)", [locationId, tenantId]);
  await admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Test')", [personId, tenantId]);
  await admin.query("insert into members(id,tenant_id,person_id,location_id,member_code,status) values($1,$2,$3,$4,$5,'active')", [memberId, tenantId, personId, locationId, `M-${memberId}`]);
  await admin.query("insert into membership_plans(id,tenant_id,location_id,name,kind,duration_days,amount_paise) values($1,$2,$3,'Monthly','duration',30,10000)", [planId, tenantId, locationId]);
  await admin.query("insert into subscriptions(id,tenant_id,member_id,plan_id,location_id,starts_on,ends_on,status,auto_renew) values($1,$2,$3,$4,$5,current_date-25,current_date+2,'active',true)", [subscriptionId, tenantId, memberId, planId, locationId]);
});
afterAll(async () => {
  for (const table of ["invoice_line_items", "invoices", "subscriptions", "membership_plans", "members", "persons", "tenant_memberships", "roles", "locations"]) await admin.query(`delete from ${table} where tenant_id=$1`, [tenantId]);
  await admin.query("delete from tenants where id=$1", [tenantId]);
  await admin.end();
});

async function assertAnchorBeforeSubscriptionRead(start: () => Promise<unknown>) {
  const holder = await admin.connect();
  let operation: Promise<unknown> | undefined;
  let blocked = false, tenantLockCode: string | null = null;
  try {
    await holder.query("begin");
    const pid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    await holder.query("lock table subscriptions in access exclusive mode");
    operation = start();
    void operation.catch(() => {});
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await holder.query("select pg_stat_clear_snapshot()");
      const waiting = await holder.query("select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and wait_event_type='Lock'", [pid]);
      if (waiting.rowCount) { blocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    try { await holder.query("select id from tenants where id=$1 for update nowait", [tenantId]); }
    catch (error) { tenantLockCode = (error as { code?: string }).code ?? "unknown"; }
  } finally { await holder.query("rollback"); holder.release(); }
  await operation;
  expect(blocked).toBe(true);
  expect(tenantLockCode).toBe("55P03");
}

describe("invoice entry points take tenant anchor before subscription access", () => {
  it("manual membership invoice", async () => assertAnchorBeforeSubscriptionRead(() => createInvoiceForSubscription({ tenantId, userId }, { subscriptionId })), 15000);
  it("renewal job", async () => assertAnchorBeforeSubscriptionRead(() => runInvoicesGenerateJob(tenantId)), 15000);
});
