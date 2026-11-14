import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { enqueueMemberNotification, enqueueStaffNotification } from "@/lib/messaging/notification-enqueue";
import { randomUUID } from "node:crypto";

const provider = vi.hoisted(() => ({ send: vi.fn(async () => ({ providerMessageId: "synthetic-message" })) }));
vi.mock("@/lib/messaging/provider", async (original) => ({ ...(await original<typeof import("@/lib/messaging/provider")>()), getMessageProvider: () => ({ name: "mock", send: provider.send }) }));
import { runWhatsAppNotificationsJob } from "@/lib/jobs/whatsapp-notifications-job";

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); provider.send.mockClear(); });
afterEach(async () => {
  if (!f) return;
  await f.admin.query("delete from message_log where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from consents where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from policy_versions where version=$1", [`ux44-${f.tenantId}`]);
  await f.cleanup();
});

async function enqueueManager(eventKey: string) {
  await withTenant(f.tenantId, (tx) => enqueueStaffNotification(tx, { tenantId: f.tenantId, eventKey, body: "Synthetic" }, { allStaff: true }));
  await f.admin.query("delete from whatsapp_notification_outbox where tenant_id=$1 and recipient_user_id<>$2", [f.tenantId, f.managerId]);
}

it("suppresses a staff notification when membership is revoked before real dispatch", async () => {
  await enqueueManager("ux44:revoked-dispatch");
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.managerMembership]);
  await runWhatsAppNotificationsJob(f.tenantId);
  expect(provider.send).not.toHaveBeenCalled();
  expect((await f.admin.query("select status from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId])).rows[0].status).toBe("suppressed");
});

it("suppresses a queued staff destination after its user is soft-deleted", async () => {
  await enqueueManager("ux44:deleted-user");
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.managerId]);
  await runWhatsAppNotificationsJob(f.tenantId);
  expect(provider.send).not.toHaveBeenCalled();
  expect((await f.admin.query("select status from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId])).rows[0].status).toBe("suppressed");
});

it("does not dispatch another tenant's queued message", async () => {
  await enqueueManager("ux44:other-tenant");
  await runWhatsAppNotificationsJob(f.otherTenant);
  expect(provider.send).not.toHaveBeenCalled();
  expect((await f.admin.query("select status from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId])).rows[0].status).toBe("pending");
});

it("sends an eligible staff destination once across repeated enqueues and dispatches", async () => {
  await enqueueManager("ux44:once");
  await withTenant(f.tenantId, (tx) => enqueueStaffNotification(tx, { tenantId: f.tenantId, eventKey: "ux44:once", body: "Synthetic" }, { allStaff: true }));
  await f.admin.query("delete from whatsapp_notification_outbox where tenant_id=$1 and recipient_user_id<>$2", [f.tenantId, f.managerId]);
  await runWhatsAppNotificationsJob(f.tenantId);
  await runWhatsAppNotificationsJob(f.tenantId);
  expect(provider.send).toHaveBeenCalledTimes(1);
  expect((await f.admin.query("select status from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId])).rows[0].status).toBe("sent");
});

it("suppresses a queued member destination when communications consent is withdrawn", async () => {
  await f.admin.query("update persons set phone='+919812345678',date_of_birth='1990-01-01' where id=$1", [f.personId]);
  await f.admin.query("insert into policy_versions(version,content) values($1,'Synthetic policy')", [`ux44-${f.tenantId}`]);
  await f.admin.query("insert into consents(id,tenant_id,person_id,purpose,granted_by,policy_version,evidence) values($1,$2,$3,'communications',$3,$4,'{}')", [randomUUID(), f.tenantId, f.personId, `ux44-${f.tenantId}`]);
  expect(await withTenant(f.tenantId, (tx) => enqueueMemberNotification(tx, { tenantId: f.tenantId, eventKey: "ux44:consent", body: "Synthetic" }, f.memberId))).toBe(1);
  await f.admin.query("update consents set withdrawn_at=now() where tenant_id=$1 and person_id=$2 and purpose='communications'", [f.tenantId, f.personId]);
  await runWhatsAppNotificationsJob(f.tenantId);
  expect(provider.send).not.toHaveBeenCalled();
  expect((await f.admin.query("select status from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId])).rows[0].status).toBe("suppressed");
});
