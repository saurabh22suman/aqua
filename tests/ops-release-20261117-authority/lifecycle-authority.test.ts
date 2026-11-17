import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { v7 as uuid } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, asUserId } from "@/lib/ids";
import { transitionTenantStatus } from "@/db/platform-tenant-status";
import { opsAction } from "@/db/ops-action";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const tenant = asTenantId(uuid());
const actor = asUserId(uuid());
const other = asUserId(uuid());

async function waitForBlockedBy(blockerPid: number) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const result = await admin.query<{ blocked: boolean }>("select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as blocked", [blockerPid]);
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No transaction blocked by fixture backend ${blockerPid}`);
}

beforeAll(async () => {
  await admin.query("insert into tenants (id, slug, name, status) values ($1, $2, 'Authority fixture', 'trial')", [tenant, `authority-${tenant}`]);
  await admin.query("insert into platform_users (id, email, name, password_hash, password_salt, role, status) values ($1, $2, 'Authority fixture', 'h', 's', 'admin', 'active'), ($3, $4, 'Other fixture', 'h', 's', 'admin', 'active')", [actor, `${actor}@platform.test`, other, `${other}@platform.test`]);
});
afterAll(async () => {
  await admin.query("delete from platform_audit_log where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.query("delete from platform_users where id = any($1::uuid[])", [[actor, other]]);
  await admin.end();
});
beforeEach(async () => {
  await admin.query("delete from platform_audit_log where tenant_id = $1", [tenant]);
  await admin.query("update tenants set status = 'trial' where id = $1", [tenant]);
  await admin.query("update platform_users set role = 'admin', status = 'active' where id = any($1::uuid[])", [[actor, other]]);
});

describe("lifecycle live authority", () => {
  it("refuses a suspended actor even for a direct service caller", async () => {
    await admin.query("update platform_users set status = 'suspended' where id = $1", [actor]);
    try {
      const outcome = await transitionTenantStatus(tenant, { targetStatus: "active" }, { actorId: actor });
      expect(outcome).toMatchObject({ kind: "error", code: "denied" });
      expect((await admin.query("select status from tenants where id = $1", [tenant])).rows[0].status).toBe("trial");
      expect((await admin.query("select id from platform_audit_log where tenant_id = $1", [tenant])).rowCount).toBe(0);
    } finally { await admin.query("update platform_users set status = 'active' where id = $1", [actor]); }
  });
  it("refuses a mismatched ambient audited actor", async () => {
    const outcome = await opsAction({ scope: "tenant.activate", actorId: other, tenantId: tenant }, () =>
      transitionTenantStatus(tenant, { targetStatus: "active" }, { actorId: actor }));
    expect(outcome).toMatchObject({ kind: "error", code: "denied" });
    expect((await admin.query("select status from tenants where id = $1", [tenant])).rows[0].status).toBe("trial");
  });
  it("allows an active admin direct caller and records its audit", async () => {
    expect(await transitionTenantStatus(tenant, { targetStatus: "active" }, { actorId: actor })).toMatchObject({ kind: "ok" });
    expect((await admin.query("select action, actor_id from platform_audit_log where tenant_id = $1", [tenant])).rows).toMatchObject([{ action: "tenant.activate", actor_id: actor }]);
  });
  it.each(["viewer", "missing"])("refuses %s actor", async (kind) => {
    if (kind === "viewer") await admin.query("update platform_users set role = 'viewer' where id = $1", [actor]);
    const actorId = kind === "missing" ? asUserId(uuid()) : actor;
    expect(await transitionTenantStatus(tenant, { targetStatus: "active" }, { actorId })).toMatchObject({ kind: "error", code: "denied" });
  });
  it.each(["scope", "tenant"])("refuses mismatched ambient %s", async (kind) => {
    const outcome = await opsAction({ scope: kind === "scope" ? "tenant.suspend" : "tenant.activate", actorId: actor, tenantId: kind === "tenant" ? uuid() : tenant }, () => transitionTenantStatus(tenant, { targetStatus: "active" }, { actorId: actor }));
    expect(outcome).toMatchObject({ kind: "error", code: "denied" });
  });
  it.each(["role", "status"])("denies when %s changes while waiting on the tenant lock", async (column) => {
    const barrier = await admin.connect();
    let write: Promise<Awaited<ReturnType<typeof transitionTenantStatus>>> | undefined;
    try {
      await barrier.query("begin");
      await barrier.query("select id from tenants where id = $1 for update", [tenant]);
      const pid = (await barrier.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      write = transitionTenantStatus(tenant, { targetStatus: "active" }, { actorId: actor });
      await waitForBlockedBy(pid);
      if (column === "role") await admin.query("update platform_users set role = 'viewer' where id = $1", [actor]);
      else await admin.query("update platform_users set status = 'suspended' where id = $1", [actor]);
      await barrier.query("commit");
      expect(await write).toMatchObject({ kind: "error", code: "denied" });
      expect((await admin.query("select status from tenants where id = $1", [tenant])).rows[0].status).toBe("trial");
      expect((await admin.query("select id from platform_audit_log where tenant_id = $1", [tenant])).rowCount).toBe(0);
    } finally {
      await barrier.query("rollback");
      barrier.release();
      if (write) await write.catch(() => undefined);
    }
  }, 10000);
  it("holds the actor lock until the status and audit commit", async () => {
    const barrier = await admin.connect();
    const demoter = await admin.connect();
    let write: Promise<Awaited<ReturnType<typeof transitionTenantStatus>>> | undefined;
    let demotion: Promise<unknown> | undefined;
    try {
      await barrier.query("begin");
      await barrier.query("lock table platform_audit_log in access exclusive mode");
      const pid = (await barrier.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      write = transitionTenantStatus(tenant, { targetStatus: "active" }, { actorId: actor });
      await waitForBlockedBy(pid);
      const writerPid = (await admin.query<{ pid: number }>("select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid)) limit 1", [pid])).rows[0]!.pid;
      demotion = demoter.query("update platform_users set role = 'viewer' where id = $1", [actor]);
      await waitForBlockedBy(writerPid);
      await barrier.query("commit");
      expect(await write).toMatchObject({ kind: "ok" });
      await demotion;
      expect((await admin.query("select status from tenants where id = $1", [tenant])).rows[0].status).toBe("active");
      expect((await admin.query("select id from platform_audit_log where tenant_id = $1", [tenant])).rowCount).toBe(1);
    } finally {
      await barrier.query("rollback");
      barrier.release();
      if (write) await write.catch(() => undefined);
      if (demotion) await demotion.catch(() => undefined);
      demoter.release();
    }
  }, 10000);
});
