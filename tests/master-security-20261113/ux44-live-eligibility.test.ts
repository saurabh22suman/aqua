import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { whatsappNotificationOutbox } from "@/db/schema/whatsapp";
import { enqueueStaffNotification } from "@/lib/messaging/notification-enqueue";
import { staffNotificationAllowed } from "@/lib/messaging/staff-notification-eligibility";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("rechecks an enqueued manager's location and live membership before dispatch", async () => {
  const event = { tenantId: f.tenantId, eventKey: "ux44:eligibility", body: "Synthetic" };
  await withTenant(f.tenantId, (tx) => enqueueStaffNotification(tx, event, { locationId: f.locationA, batchId: f.batchA }));
  const row = await withTenant(f.tenantId, async (tx) => (await tx.select().from(whatsappNotificationOutbox).where(and(eq(whatsappNotificationOutbox.tenantId, f.tenantId), eq(whatsappNotificationOutbox.eventKey, event.eventKey), eq(whatsappNotificationOutbox.recipientUserId, f.managerId))))[0]);
  expect(row).toBeDefined();
  if (!row) return;
  expect(await withTenant(f.tenantId, (tx) => staffNotificationAllowed(tx, row))).toBe(true);
  await f.admin.query("update batches set location_id=null where id=$1", [f.batchA]);
  expect(await withTenant(f.tenantId, (tx) => staffNotificationAllowed(tx, row))).toBe(false);
  await f.admin.query("update batches set location_id=$1 where id=$2", [f.locationA, f.batchA]);
  await f.admin.query("delete from membership_locations where tenant_id=$1 and membership_id=$2", [f.tenantId, f.managerMembership]);
  expect(await withTenant(f.tenantId, (tx) => staffNotificationAllowed(tx, row))).toBe(false);
  await f.admin.query("update tenant_memberships set status='revoked' where tenant_id=$1 and id=$2", [f.tenantId, f.managerMembership]);
  expect(await withTenant(f.tenantId, (tx) => staffNotificationAllowed(tx, row))).toBe(false);
});

it("does not dispatch after a role is withdrawn", async () => {
  await f.admin.query("update tenant_memberships set status='active',all_locations=true where id=$1", [f.managerMembership]);
  const event = { tenantId: f.tenantId, eventKey: "ux44:role", body: "Synthetic" };
  await withTenant(f.tenantId, (tx) => enqueueStaffNotification(tx, event, { allStaff: true }));
  const row = await withTenant(f.tenantId, async (tx) => (await tx.select().from(whatsappNotificationOutbox).where(and(eq(whatsappNotificationOutbox.tenantId, f.tenantId), eq(whatsappNotificationOutbox.eventKey, event.eventKey), eq(whatsappNotificationOutbox.recipientUserId, f.managerId))))[0]);
  expect(row).toBeDefined();
  if (!row) return;
  expect(await withTenant(f.tenantId, (tx) => staffNotificationAllowed(tx, row))).toBe(true);
  await f.admin.query("update roles set deleted_at=now() where tenant_id=$1 and key='manager'", [f.tenantId]);
  expect(await withTenant(f.tenantId, (tx) => staffNotificationAllowed(tx, row))).toBe(false);
});

it("does not dispatch to a soft-deleted user", async () => {
  await f.admin.query("update roles set deleted_at=null where tenant_id=$1 and key='manager'", [f.tenantId]);
  const event = { tenantId: f.tenantId, eventKey: "ux44:deleted-user", body: "Synthetic" };
  await withTenant(f.tenantId, (tx) => enqueueStaffNotification(tx, event, { allStaff: true }));
  const row = await withTenant(f.tenantId, async (tx) => (await tx.select().from(whatsappNotificationOutbox).where(and(eq(whatsappNotificationOutbox.tenantId, f.tenantId), eq(whatsappNotificationOutbox.eventKey, event.eventKey), eq(whatsappNotificationOutbox.recipientUserId, f.managerId))))[0]);
  expect(row).toBeDefined();
  if (!row) return;
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.managerId]);
  expect(await withTenant(f.tenantId, (tx) => staffNotificationAllowed(tx, row))).toBe(false);
});
