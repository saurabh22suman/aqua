import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.cleanup(); });

it("accepts null and all six supported roles, and rejects an unknown role", async () => {
  const client = await f.admin.connect();
  try {
    await client.query("begin");
    for (const role of [null, "owner", "coach", "receptionist", "worker", "manager", "accountant"]) {
      await client.query("insert into whatsapp_notification_outbox(id,tenant_id,event_key,recipient_user_id,phone,body,recipient_role) values($1,$2,$3,$4,'+919000000001','Synthetic',$5)", [randomUUID(), f.tenantId, `constraint:${randomUUID()}`, f.userId, role]);
    }
    await expect(client.query("insert into whatsapp_notification_outbox(id,tenant_id,event_key,recipient_user_id,phone,body,recipient_role) values($1,$2,$3,$4,'+919000000001','Synthetic','unknown')", [randomUUID(), f.tenantId, `constraint:${randomUUID()}`, f.userId])).rejects.toMatchObject({ code: "23514", constraint: "whatsapp_notification_outbox_recipient_role_check" });
  } finally {
    await client.query("rollback");
    client.release();
  }
});
