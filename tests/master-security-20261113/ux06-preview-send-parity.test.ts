import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { previewAnnouncementAudience, sendAnnouncement } from "@/lib/services/announcements";
import { randomUUID } from "node:crypto";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,m.role_id,'messaging.send' from tenant_memberships m where m.tenant_id=$1 and m.user_id=any($2::uuid[])", [f.tenantId, [f.userId, f.managerId]]); });
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from notifications where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from announcements where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from consents where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardianships where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from policy_versions where version=$1", [`ux06-${f.tenantId}`]);
  await f.cleanup();
});

it("counts one destination when siblings and staff share a phone", async () => {
  const guardian = randomUUID(), siblingPerson = randomUUID(), sibling = randomUUID();
  const { rows: [owner] } = await f.admin.query("select phone from users where id=$1", [f.userId]);
  await f.admin.query("insert into persons(id,tenant_id,full_name,phone) values($1,$3,'Synthetic guardian',$4),($2,$3,'Synthetic sibling',null)", [guardian, siblingPerson, f.tenantId, owner.phone]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values($1,$2,$3,$4,'active','SIBLING')", [sibling, f.tenantId, siblingPerson, f.locationA]);
  await f.admin.query("insert into policy_versions(version,content) values($1,'Synthetic policy')", [`ux06-${f.tenantId}`]);
  for (const person of [f.personId, siblingPerson]) {
    await f.admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship,is_primary) values($1,$2,$3,$4,'parent',true)", [randomUUID(), f.tenantId, person, guardian]);
    await f.admin.query("insert into consents(id,tenant_id,person_id,purpose,granted_by,policy_version,evidence) values($1,$2,$3,'communications',$4,$5,'{}')", [randomUUID(), f.tenantId, person, guardian, `ux06-${f.tenantId}`]);
  }
  for (const member of [f.memberId, sibling]) await f.admin.query("insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$4,'2026-01-01')", [randomUUID(), f.tenantId, member, f.batchA]);
  const ctx = f.context(); ctx.permissions.add("messaging.send");
  const before = await f.admin.query("select count(*)::int n from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId]);
  const preview = await previewAnnouncementAudience(ctx, { audience: "batch", batchId: f.batchA });
  expect(preview.ok).toBe(true);
  if (!preview.ok) return;
  const afterPreview = await f.admin.query("select count(*)::int n from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId]);
  expect(afterPreview.rows[0].n).toBe(before.rows[0].n);
  const result = await sendAnnouncement(ctx, { audience: "batch", batchId: f.batchA, title: "Duplicates", body: "Synthetic" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const rows = await f.admin.query("select phone from whatsapp_notification_outbox where tenant_id=$1 and event_key=$2", [f.tenantId, `announcement:${result.id}`]);
  expect(rows.rows.filter((row: { phone: string }) => row.phone === owner.phone)).toHaveLength(1);
  expect(result.whatsappRecipientCount).toBe(preview.whatsapp.eligibleCount);
  expect(rows.rowCount).toBe(preview.whatsapp.eligibleCount);
  expect(Number(before.rows[0].n) + rows.rowCount!).toBeGreaterThan(Number(before.rows[0].n));
});

it("previews without writes and matches the subsequent in-app and WhatsApp fan-out", async () => {
  const ctx = f.context(); ctx.permissions.add("messaging.send");
  const before = await f.admin.query("select count(*)::int n from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId]);
  const preview = await previewAnnouncementAudience(ctx, { audience: "batch", batchId: f.batchA });
  expect(preview.ok).toBe(true);
  if (!preview.ok) return;
  const afterPreview = await f.admin.query("select count(*)::int n from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId]);
  expect(afterPreview.rows[0].n).toBe(before.rows[0].n);
  const result = await sendAnnouncement(ctx, { audience: "batch", batchId: f.batchA, title: "Synthetic", body: "Synthetic" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.recipientCount).toBe(preview.inApp.eligibleCount);
  expect(result.whatsappRecipientCount).toBe(preview.whatsapp.eligibleCount);
});
