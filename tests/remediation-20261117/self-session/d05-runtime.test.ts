import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import type { MutationActor } from "@/lib/auth/context";
import { addDays, todayInZone } from "@/lib/time/tz";

vi.mock("@/lib/messaging/notification-enqueue", () => ({ enqueueMemberNotification: vi.fn(), enqueueStaffNotification: vi.fn() }));
import { detectAbsenceAlerts } from "@/lib/services/absence-alerts";
import { createSkillFramework, createSkillNode } from "@/lib/services/skill-framework";
import { createInvoiceForSubscription } from "@/lib/services/invoice-mutations";
import { addHoliday } from "@/lib/services/holidays";
import { auditActor } from "@/lib/audit/write";
import { enqueueMemberNotification, enqueueStaffNotification } from "@/lib/messaging/notification-enqueue";

let f: Awaited<ReturnType<typeof fixture>>, activity: string;
const subscription = randomUUID(), otherLocationSubscription = randomUUID(), otherPlan = randomUUID();
const untyped = (x: unknown) => x as MutationActor;
beforeAll(async () => {
  f = await fixture();
  const { rows: [type] } = await f.admin.query<{ key: string }>("select key from activity_types limit 1");
  activity = type.key;
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'invoices.write')", [f.tenantId, f.roleId]);
  const today = todayInZone("Asia/Kolkata");
  await f.admin.query("insert into subscriptions(id,tenant_id,member_id,plan_id,location_id,starts_on,ends_on,status) values($1,$2,$3,$4,$5,$6,$7,'active')", [subscription, f.tenantId, f.memberId, f.planId, f.locationA, addDays(today, -10), addDays(today, 20)]);
  await f.admin.query("insert into membership_plans(id,tenant_id,name,kind,duration_days,amount_paise,location_id) values($1,$2,'Other site','duration',30,10000,$3)", [otherPlan, f.tenantId, f.locationB]);
  await f.admin.query("insert into subscriptions(id,tenant_id,member_id,plan_id,location_id,starts_on,ends_on,status) values($1,$2,$3,$4,$5,$6,$7,'active')", [otherLocationSubscription, f.tenantId, f.memberId, otherPlan, f.locationB, addDays(today, -10), addDays(today, 20)]);
  for (let i = 1; i <= 3; i++) {
    const day = addDays(today, -i), session = randomUUID();
    await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at,status) values($1,$2,$3,$4,$5,$6,$7,'held')", [session, f.tenantId, f.batchA, f.locationA, day, `${day}T04:30:00Z`, `${day}T05:30:00Z`]);
    await f.admin.query("insert into attendance(id,tenant_id,session_id,member_id,status,client_id) values($1,$2,$3,$4,'absent',$5)", [randomUUID(), f.tenantId, session, f.memberId, randomUUID()]);
  }
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from absence_alerts where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from skill_nodes where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from skill_frameworks where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from tenant_holidays where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});
it("refuses tenant-only absence detection before any alert or notification", async () => {
  const result = await detectAbsenceAlerts(untyped({ tenantId: f.tenantId })).catch(() => null);
  expect(result?.inserted ?? 0).toBe(0);
  expect((await f.admin.query("select id from absence_alerts where tenant_id=$1", [f.tenantId])).rowCount).toBe(0);
});
it("refuses a tenant-only framework creation before a write", async () => {
  const result = await createSkillFramework(untyped({ tenantId: f.tenantId }), { activityTypeKey: activity, name: "D05 missing actor" });
  expect(result.ok).toBe(false);
  expect((await f.admin.query("select id from skill_frameworks where tenant_id=$1 and name='D05 missing actor'", [f.tenantId])).rowCount).toBe(0);
});
it("attributes a minimal authenticated owner to the actual audit actor", async () => {
  const result = await addHoliday({ tenantId: f.tenantId, userId: f.userId }, { name: "D05 holiday", holidayDate: "2026-03-01" });
  expect(result.kind).toBe("ok");
  const { rows: [audit] } = await f.admin.query("select actor_type,actor_id from audit_log where tenant_id=$1 and action='holiday.add' order by created_at desc limit 1", [f.tenantId]);
  expect(audit).toMatchObject({ actor_type: "user", actor_id: f.userId });
});
it("refuses invoice issue for a live non-writer even when scope is valid", async () => {
  const result = await createInvoiceForSubscription({ tenantId: f.tenantId, userId: f.receptionistId }, { subscriptionId: subscription });
  expect(result.ok).toBe(false);
  expect((await f.admin.query("select id from invoices where tenant_id=$1", [f.tenantId])).rowCount).toBe(0);
});
it("distinguishes explicit system audit from missing and mixed actors", () => {
  expect(auditActor({ systemActor: true } as never)).toMatchObject({ actorType: "system", actorId: null });
  expect(() => auditActor({})).toThrow();
  expect(() => auditActor({ userId: f.userId, systemActor: true } as never)).toThrow();
});
it("refuses node creation from an unprivileged actor", async () => {
  const owner = await createSkillFramework({ tenantId: f.tenantId, userId: f.userId }, { activityTypeKey: activity, name: "D05 owned framework" });
  expect(owner.ok).toBe(true);
  if (!owner.ok) return;
  await f.admin.query("delete from role_permissions where tenant_id=$1 and permission_key='settings.manage' and role_id=(select role_id from tenant_memberships where tenant_id=$1 and user_id=$2)", [f.tenantId, f.receptionistId]);
  const result = await createSkillNode({ tenantId: f.tenantId, userId: f.receptionistId }, { frameworkId: owner.id, name: "D05 denied node", ordinal: 1 });
  expect(result.ok).toBe(false);
});
it("only permits a structurally explicit job or a live authorized owner to detect alerts", async () => {
  const count = async () => (await f.admin.query("select id from absence_alerts where tenant_id=$1", [f.tenantId])).rowCount;
  const clear = async () => { await f.admin.query("delete from absence_alerts where tenant_id=$1", [f.tenantId]); vi.clearAllMocks(); };
  await clear();
  const auditsBefore = (await f.admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='absence_alert.create'", [f.tenantId])).rows[0].n;
  const invalid = [
    { tenantId: f.tenantId, systemActor: true, userId: f.userId },
    { tenantId: f.tenantId, systemActor: true, locationIds: [] },
    { tenantId: f.tenantId, userId: f.receptionistId, roleKey: "owner", permissions: new Set(["settings.manage"]) },
  ];
  for (const actor of invalid) {
    await expect(detectAbsenceAlerts(untyped(actor))).rejects.toThrow();
    expect(await count()).toBe(0);
    expect(enqueueMemberNotification).not.toHaveBeenCalled();
    expect(enqueueStaffNotification).not.toHaveBeenCalled();
  }
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.userId]);
  try { await expect(detectAbsenceAlerts({ tenantId: f.tenantId, userId: f.userId })).rejects.toThrow(); }
  finally { await f.admin.query("update users set deleted_at=null where id=$1", [f.userId]); }
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.membershipId]);
  try { await expect(detectAbsenceAlerts({ tenantId: f.tenantId, userId: f.userId })).rejects.toThrow(); }
  finally { await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.membershipId]); }
  expect(await count()).toBe(0);
  expect((await f.admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='absence_alert.create'", [f.tenantId])).rows[0].n).toBe(auditsBefore);
  const job = await detectAbsenceAlerts({ tenantId: f.tenantId, systemActor: true });
  expect(job.inserted).toBeGreaterThan(0);
  expect(enqueueMemberNotification).toHaveBeenCalled();
  const audit = await f.admin.query("select actor_type,actor_id,source from audit_log where tenant_id=$1 and action='absence_alert.create' order by created_at desc limit 1", [f.tenantId]);
  expect(audit.rows[0]).toMatchObject({ actor_type: "system", actor_id: null, source: "job" });
  await clear();
  expect((await detectAbsenceAlerts({ tenantId: f.tenantId, userId: f.userId })).inserted).toBeGreaterThan(0);
});
it("checks live settings authority and tenant scope for framework and node mutations", async () => {
  const payload = { activityTypeKey: activity, name: "D05 authority" };
  const countBefore = (await f.admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='skill_framework.create'", [f.tenantId])).rows[0].n;
  for (const actor of [
    { tenantId: f.tenantId, systemActor: true },
    { tenantId: f.tenantId, userId: f.receptionistId, permissions: new Set(["settings.manage"]), roleKey: "owner" },
    { tenantId: f.otherTenant, userId: f.userId },
    { tenantId: f.tenantId, userId: f.userId, systemActor: true },
  ]) expect((await createSkillFramework(untyped(actor), payload)).ok).toBe(false);
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.membershipId]);
  try { expect((await createSkillFramework({ tenantId: f.tenantId, userId: f.userId }, payload)).ok).toBe(false); }
  finally { await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.membershipId]); }
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.userId]);
  try { expect((await createSkillFramework({ tenantId: f.tenantId, userId: f.userId }, payload)).ok).toBe(false); }
  finally { await f.admin.query("update users set deleted_at=null where id=$1", [f.userId]); }
  expect((await f.admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='skill_framework.create'", [f.tenantId])).rows[0].n).toBe(countBefore);
  expect((await f.admin.query("select id from skill_frameworks where tenant_id=$1 and name=$2", [f.tenantId, payload.name])).rowCount).toBe(0);
  const created = await createSkillFramework({ tenantId: f.tenantId, userId: f.userId }, payload);
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect((await createSkillNode({ tenantId: f.tenantId, userId: f.userId }, { frameworkId: created.id, name: "D05 permitted node", ordinal: 2 })).ok).toBe(true);
  expect((await createSkillNode({ tenantId: f.otherTenant, userId: f.userId }, { frameworkId: created.id, name: "D05 foreign node", ordinal: 3 })).ok).toBe(false);
});
it("requires a live invoice writer and preserves counter and audit on every refusal", async () => {
  const snapshot = async () => ({
    invoices: (await f.admin.query("select count(*)::int n from invoices where tenant_id=$1", [f.tenantId])).rows[0].n,
    audits: (await f.admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='invoice.issue'", [f.tenantId])).rows[0].n,
    counters: (await f.admin.query("select * from invoice_number_counters where tenant_id=$1", [f.tenantId])).rows,
  });
  const before = await snapshot();
  for (const actor of [
    { tenantId: f.tenantId }, { tenantId: f.tenantId, systemActor: true },
    { tenantId: f.tenantId, systemActor: true, userId: f.userId },
    { tenantId: f.tenantId, userId: f.receptionistId, permissions: new Set(["invoices.write"]) },
  ]) expect((await createInvoiceForSubscription(untyped(actor), { subscriptionId: subscription })).ok).toBe(false);
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.membershipId]);
  try { expect((await createInvoiceForSubscription({ tenantId: f.tenantId, userId: f.userId }, { subscriptionId: subscription })).ok).toBe(false); }
  finally { await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.membershipId]); }
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.userId]);
  try { expect((await createInvoiceForSubscription({ tenantId: f.tenantId, userId: f.userId }, { subscriptionId: subscription })).ok).toBe(false); }
  finally { await f.admin.query("update users set deleted_at=null where id=$1", [f.userId]); }
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,role_id,'invoices.write' from tenant_memberships where id=$2", [f.tenantId, f.managerMembership]);
  expect((await createInvoiceForSubscription({ tenantId: f.tenantId, userId: f.managerId }, { subscriptionId: otherLocationSubscription })).ok).toBe(false);
  expect((await createInvoiceForSubscription({ tenantId: f.otherTenant, userId: f.userId }, { subscriptionId: subscription })).ok).toBe(false);
  expect(await snapshot()).toEqual(before);
  const issued = await createInvoiceForSubscription({ tenantId: f.tenantId, userId: f.userId }, { subscriptionId: subscription });
  expect(issued.ok).toBe(true);
});
