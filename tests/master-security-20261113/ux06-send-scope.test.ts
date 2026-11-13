import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { sendAnnouncement } from "@/lib/services/announcements";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,m.role_id,'messaging.send' from tenant_memberships m where m.tenant_id=$1 and m.user_id=any($2::uuid[])", [f.tenantId, [f.userId, f.managerId]]); });
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from notifications where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from announcements where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("refuses cross-facility batch and broad sends by a restricted manager", async () => {
  const ctx = f.context(f.managerId, "manager");
  ctx.permissions.add("messaging.send");
  const message = { title: "Synthetic", body: "Synthetic" };
  expect((await sendAnnouncement(ctx, { ...message, audience: "batch", batchId: f.batchB })).ok).toBe(false);
  expect((await sendAnnouncement(ctx, { ...message, audience: "all" })).ok).toBe(false);
  const rows = await f.admin.query("select count(*)::int n from announcements where tenant_id=$1", [f.tenantId]);
  expect(rows.rows[0].n).toBe(0);
});
