import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { previewAnnouncementAudience } from "@/lib/services/announcements";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,m.role_id,'messaging.send' from tenant_memberships m where m.tenant_id=$1 and m.user_id=any($2::uuid[])", [f.tenantId, [f.userId, f.managerId]]); });
afterAll(async () => { await f?.cleanup(); });

it("previews channel-specific eligible counts without creating messages", async () => {
  const before = await f.admin.query("select (select count(*) from announcements where tenant_id=$1)::int a, (select count(*) from notifications where tenant_id=$1)::int n, (select count(*) from whatsapp_notification_outbox where tenant_id=$1)::int w", [f.tenantId]);
  const ctx = f.context();
  ctx.permissions.add("messaging.send");
  const result = await previewAnnouncementAudience(ctx, { audience: "all" });
  expect(result).toMatchObject({ ok: true, inApp: { eligibleCount: 3 }, whatsapp: { eligibleCount: 3 } });
  if (result.ok) {
    expect(result.inApp.exclusions).toBeUndefined();
    expect(result.whatsapp.exclusions).toBeUndefined();
  }
  const after = await f.admin.query("select (select count(*) from announcements where tenant_id=$1)::int a, (select count(*) from notifications where tenant_id=$1)::int n, (select count(*) from whatsapp_notification_outbox where tenant_id=$1)::int w", [f.tenantId]);
  expect(after.rows[0]).toEqual(before.rows[0]);
});

it("does not let a restricted sender use a management grant to preview another location", async () => {
  const ctx = f.context(f.managerId, "manager");
  ctx.permissions.add("messaging.send");
  expect((await previewAnnouncementAudience(ctx, { audience: "batch", batchId: f.batchB })).ok).toBe(false);
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.managerMembership]);
  expect((await previewAnnouncementAudience(ctx, { audience: "batch", batchId: f.batchA })).ok).toBe(false);
});

it("includes eligible staff in the in-app batch audience", async () => {
  await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.managerMembership]);
  const ctx = f.context();
  ctx.permissions.add("messaging.send");
  expect(await previewAnnouncementAudience(ctx, { audience: "batch", batchId: f.batchA })).toMatchObject({ ok: true, inApp: { eligibleCount: 3 } });
});
