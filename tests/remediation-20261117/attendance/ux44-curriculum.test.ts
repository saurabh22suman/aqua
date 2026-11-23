import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { staffAudienceCandidates } from "@/lib/messaging/notification-enqueue";
import { staffNotificationAllowed } from "@/lib/messaging/staff-notification-eligibility";
import type { whatsappNotificationOutbox } from "@/db/schema/whatsapp";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("update roles set key='curriculum_lead' where tenant_id=$1 and key='manager'", [f.tenantId]);
});
it("rechecks a lead's current batch assignment before dispatch", async () => {
  const phone = (await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.managerId])).rows[0]!.phone;
  const row = { tenantId: f.tenantId, recipientUserId: f.managerId, recipientRole: "curriculum_lead", phone,
    eventKey: "session:synthetic", scopeLocationId: f.locationA, scopeSessionId: null, scopeBatchId: f.batchA } as typeof whatsappNotificationOutbox.$inferSelect;
  expect(await withTenant(f.tenantId, tx => staffNotificationAllowed(tx, row))).toBe(false);
  await f.admin.query("update staff set user_id=$1 where id=$2", [f.managerId, f.coachId]);
  expect(await withTenant(f.tenantId, tx => staffNotificationAllowed(tx, row))).toBe(true);
});
afterAll(async () => { if (f) await f.cleanup(); });
it("includes the assigned curriculum lead, not unrelated leads, for a scoped session", async () => {
  const assigned = await withTenant(f.tenantId, tx => staffAudienceCandidates(tx, { tenantId: f.tenantId }, { locationId: f.locationA, coachUserId: f.managerId, sessionId: "synthetic" }));
  const unrelated = await withTenant(f.tenantId, tx => staffAudienceCandidates(tx, { tenantId: f.tenantId }, { locationId: f.locationA, coachUserId: f.userId, sessionId: "synthetic" }));
  expect(assigned.some(row => row.userId === f.managerId)).toBe(true);
  expect(unrelated.some(row => row.userId === f.managerId)).toBe(false);
});
