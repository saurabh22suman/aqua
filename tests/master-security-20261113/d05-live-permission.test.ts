import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { callerHasPermission, resourceRole } from "@/lib/services/resource-access";
import { cancelSession } from "@/lib/services/session-lifecycle";

let f: Awaited<ReturnType<typeof fixture>>;
const sessionId = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,coach_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,'2026-11-13','2026-11-13T10:00Z','2026-11-13T11:00Z')", [sessionId, f.tenantId, f.batchA, f.locationA, f.coachId]);
});
afterAll(async () => { await f?.cleanup(); });

it("never grants a claimed role or permission without a human identity", async () => {
  await withTenant(f.tenantId, async (tx) => {
    expect(await callerHasPermission(tx, { tenantId: f.tenantId, roleKey: "owner" }, "programs.write")).toBe(false);
  });
  // @ts-expect-error Exercise malformed input despite the lifecycle actor type.
  expect(await cancelSession({ tenantId: f.tenantId, roleKey: "owner" }, sessionId)).toMatchObject({ kind: "error", code: "forbidden" });
});

it("never grants a permission-set claim without a human identity", async () => {
  expect(await withTenant(f.tenantId, (tx) => callerHasPermission(tx, { tenantId: f.tenantId, permissions: new Set(["programs.write"]) }, "programs.write"))).toBe(false);
});

it("uses the live membership role rather than a stale claimed role", async () => {
  expect(await withTenant(f.tenantId, (tx) => resourceRole(tx, { tenantId: f.tenantId, userId: f.managerId, roleKey: "owner" }))).toBe("manager");
});

it("does not restore a removed grant from a claimed role template", async () => {
  await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=$2 and permission_key='programs.write'", [f.tenantId, f.roleId]);
  const ctx = { tenantId: f.tenantId, userId: f.userId, roleKey: "owner" };
  expect(await withTenant(f.tenantId, (tx) => callerHasPermission(tx, ctx, "programs.write"))).toBe(false);
  expect(await cancelSession(ctx, sessionId)).toMatchObject({ kind: "error", code: "forbidden" });
  const { rows: [row] } = await f.admin.query("select status from sessions where id=$1", [sessionId]);
  expect(row.status).not.toBe("cancelled");
});

it("denies a real lifecycle mutation when the live role lacks the claimed template grant", async () => {
  await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=$2 and permission_key='programs.write'", [f.tenantId, f.roleId]);
  const result = await cancelSession({ tenantId: f.tenantId, userId: f.userId, roleKey: "owner" }, sessionId);
  expect(result).toMatchObject({ kind: "error", code: "forbidden" });
  expect((await f.admin.query("select status from sessions where id=$1", [sessionId])).rows[0].status).not.toBe("cancelled");
});

it("does not accept a stale permission set after the live grant is removed", async () => {
  const ctx = { ...f.context(), permissions: new Set(["programs.write"]) };
  expect(await withTenant(f.tenantId, (tx) => callerHasPermission(tx, ctx, "programs.write"))).toBe(false);
});

it("allows and attributes a real human mutation when its live role has the grant", async () => {
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'programs.write')", [f.tenantId, f.roleId]);
  const result = await cancelSession(f.context(), sessionId);
  expect(result).toMatchObject({ kind: "ok" });
  const { rows: [audit] } = await f.admin.query("select actor_type,actor_id,source from audit_log where tenant_id=$1 and entity_id=$2 and action='session.cancel.notification'", [f.tenantId, sessionId]);
  expect(audit).toMatchObject({ actor_type: "user", actor_id: f.userId, source: "web" });
});
