import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { enqueueStaffNotification } from "@/lib/messaging/notification-enqueue";
import { randomUUID } from "node:crypto";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

describe("UX44 everyone notification", () => {
  it("enqueues the active manager along with legacy staff, without duplicates", async () => {
    const event = { tenantId: f.tenantId, eventKey: "ux44:synthetic", body: "Synthetic update" };
    await withTenant(f.tenantId, (tx) => enqueueStaffNotification(tx, event, { allStaff: true }));
    await withTenant(f.tenantId, (tx) => enqueueStaffNotification(tx, event, { allStaff: true }));
    const rows = await f.admin.query<{ recipient_user_id: string }>(
      "select recipient_user_id from whatsapp_notification_outbox where tenant_id=$1 and event_key=$2",
      [f.tenantId, event.eventKey],
    );
    expect(rows.rows.map((r) => r.recipient_user_id).sort()).toEqual(
      [f.userId, f.managerId, f.receptionistId].sort(),
    );
  });

  it("includes active worker and accountant memberships", async () => {
    const worker = randomUUID(), accountant = randomUUID();
    const roleWorker = randomUUID(), roleAccountant = randomUUID();
    await f.admin.query("insert into users(id,phone) values($1,$2),($3,$4)",
      [worker, `+91${String(BigInt('0x' + worker.replaceAll('-', '').slice(0, 12)) % 9000000000n + 1000000000n)}`,
       accountant, `+91${String(BigInt('0x' + accountant.replaceAll('-', '').slice(0, 12)) % 9000000000n + 1000000000n)}`]);
    await f.admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$3,'worker','Worker','/worker',4),($2,$3,'accountant','Accountant','/owner',5)", [roleWorker, roleAccountant, f.tenantId]);
    await f.admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$3,$4,$6,'active',true),($2,$3,$5,$7,'active',true)", [randomUUID(), randomUUID(), f.tenantId, worker, accountant, roleWorker, roleAccountant]);
    const event = { tenantId: f.tenantId, eventKey: "ux44:new-roles", body: "Synthetic update" };
    try {
      await withTenant(f.tenantId, (tx) => enqueueStaffNotification(tx, event, { allStaff: true }));
      const rows = await f.admin.query<{ recipient_user_id: string }>("select recipient_user_id from whatsapp_notification_outbox where tenant_id=$1 and event_key=$2", [f.tenantId, event.eventKey]);
      expect(rows.rows.map(r => r.recipient_user_id)).toEqual(expect.arrayContaining([worker, accountant]));
    } finally {
      await f.admin.query("delete from whatsapp_notification_outbox where tenant_id=$1 and event_key=$2", [f.tenantId, event.eventKey]);
      await f.admin.query("delete from tenant_memberships where tenant_id=$1 and user_id=any($2::uuid[])", [f.tenantId, [worker, accountant]]);
      await f.admin.query("delete from roles where id=any($1::uuid[])", [[roleWorker, roleAccountant]]);
      await f.admin.query("delete from users where id=any($1::uuid[])", [[worker, accountant]]);
    }
  });
});
