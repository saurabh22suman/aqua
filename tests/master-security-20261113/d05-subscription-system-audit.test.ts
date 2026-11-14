import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { cancelSubscription, createSubscription, pauseSubscription, resumeSubscription } from "@/lib/services/subscriptions";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.cleanup(); });

it("does not let an identity-free system caller create an unaudited subscription", async () => {
  const before = await f.admin.query("select count(*)::int as n from subscriptions where tenant_id=$1", [f.tenantId]);
  const auditBefore = await f.admin.query("select count(*)::int as n from audit_log where tenant_id=$1 and action='subscription.create'", [f.tenantId]);
  const result = await createSubscription({ tenantId: f.tenantId, systemActor: true }, { memberId: f.memberId, planId: f.planId, startsOn: "2026-11-01" });
  expect(result.ok).toBe(false);
  expect((await f.admin.query("select count(*)::int as n from subscriptions where tenant_id=$1", [f.tenantId])).rows).toEqual(before.rows);
  expect((await f.admin.query("select count(*)::int as n from audit_log where tenant_id=$1 and action='subscription.create'", [f.tenantId])).rows).toEqual(auditBefore.rows);
});

it("refuses identity-free transitions while retaining the authenticated positive control", async () => {
  const created = await createSubscription(f.context(), { memberId: f.memberId, planId: f.planId, startsOn: "2026-11-01" });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const ctx = { tenantId: f.tenantId, systemActor: true as const };
  const input = { id: created.id };
  expect((await pauseSubscription(ctx, input)).ok).toBe(false);
  expect((await resumeSubscription(ctx, input)).ok).toBe(false);
  expect((await cancelSubscription(ctx, input)).ok).toBe(false);
  expect((await f.admin.query("select status from subscriptions where id=$1", [created.id])).rows).toEqual([{ status: "active" }]);
  expect((await f.admin.query("select action from audit_log where tenant_id=$1 and entity_id=$2", [f.tenantId, created.id])).rows).toEqual([{ action: "subscription.create" }]);
});
