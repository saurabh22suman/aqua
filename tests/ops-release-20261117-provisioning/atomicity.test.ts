import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asUserId } from "@/lib/ids";
import { createLead, getLead, markLeadConverted, transitionLead } from "@/db/platform-leads";
import { convertLead } from "@/db/platform-lead-conversion";
import { asTenantId } from "@/lib/ids";
import { opsAction } from "@/db/ops-action";

// Run only under the coordinator's disposable, isolated DB guard.
const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const actorId = asUserId(uuidv7());
const run = uuidv7().replaceAll("-", "");

beforeAll(async () => {
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'Provisioning test', 'h', 's', 'admin', 'active')`,
    [actorId, `${run}@platform.test`],
  );
});

afterAll(async () => {
  await admin.query("drop trigger if exists ops_provision_test_fail on platform_leads");
  await admin.query("drop function if exists ops_provision_test_fail()");
  await admin.end();
});

async function lead() {
  const result = await createLead({
    businessName: `Provisioning ${run}`,
    contactName: "Test operator",
    phone: "+919876543210",
    source: "other",
    qualification: { locations: 2 },
  }, { actorId });
  if (result.kind !== "ok") throw new Error(result.message);
  return result.leadId;
}

async function waitForBlocked(blockerPid: number, count: number) {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const result = await admin.query<{ count: string }>(
      `with recursive blocked(pid) as (
        select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))
        union
        select a.pid from pg_stat_activity a join blocked b on b.pid = any(pg_blocking_pids(a.pid))
      ) select count(*)::text from blocked`,
      [blockerPid],
    );
    if (Number(result.rows[0].count) >= count) return;
  }
  throw new Error(`Expected ${count} queries blocked by the held lead lock`);
}

describe("atomic lead provisioning", () => {
  it("rolls back tenant work and audit if lead update fails", async () => {
    const leadId = await lead();
    const slug = `rollback-${run}`;
    await admin.query(`create function ops_provision_test_fail() returns trigger language plpgsql as $$
      begin if new.id = '${leadId}'::uuid then raise exception 'injected lead update failure'; end if; return new; end $$`);
    await admin.query("create trigger ops_provision_test_fail before update on platform_leads for each row execute function ops_provision_test_fail()");
    try {
      await expect(convertLead(leadId, { slug }, { actorId })).rejects.toThrow();
      const tenant = await admin.query("select id from tenants where slug = $1", [slug]);
      expect(tenant.rows).toHaveLength(0);
      const current = await admin.query("select status, trial_tenant_id from platform_leads where id = $1", [leadId]);
      expect(current.rows[0]).toMatchObject({ status: "lead", trial_tenant_id: null });
      const audits = await admin.query("select id from platform_audit_log where detail->>'slug' = $1", [slug]);
      expect(audits.rows).toHaveLength(0);
    } finally {
      await admin.query("drop trigger if exists ops_provision_test_fail on platform_leads");
      await admin.query("drop function if exists ops_provision_test_fail()");
    }
  });

  it("serializes simultaneous different-slug requests for one lead", async () => {
    const leadId = await lead();
    const slugs = [`race-a-${run}`, `race-b-${run}`];
    const results = await Promise.all(slugs.map((slug) => convertLead(leadId, { slug }, { actorId })));
    const tenant = await admin.query("select id from tenants where slug = any($1::text[])", [slugs]);
    expect(tenant.rows).toHaveLength(1);
    expect(results.filter((result) => result.kind === "ok")).toHaveLength(1);
    const current = await admin.query("select trial_tenant_id from platform_leads where id = $1", [leadId]);
    expect(current.rows[0].trial_tenant_id).toBe(tenant.rows[0].id);
  });

  it("rejects business completion of an unlinked lead without a reason", async () => {
    const leadId = await lead();
    const tenantId = asTenantId(uuidv7());
    await admin.query("insert into tenants (id, slug, name, status) values ($1, $2, 'Test tenant', 'trial')", [tenantId, `unlinked-${run}`]);
    const result = await markLeadConverted(leadId, tenantId, { actorId });
    expect(result.kind).toBe("error");
    const current = await admin.query("select status, converted_tenant_id from platform_leads where id = $1", [leadId]);
    expect(current.rows[0]).toMatchObject({ status: "lead", converted_tenant_id: null });
  });

  it("aligns the default deadline and reads later tenant edits authoritatively", async () => {
    const leadId = await lead();
    const before = Date.now();
    const result = await convertLead(leadId, { slug: `deadline-${run}` }, { actorId });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const tenant = await admin.query("select t.trial_expires_at, l.trial_expires_at as lead_deadline from tenants t join platform_leads l on l.trial_tenant_id = t.id where t.id = $1", [result.tenantId]);
    expect(tenant.rows[0].trial_expires_at.getTime()).toBe(tenant.rows[0].lead_deadline.getTime());
    expect(tenant.rows[0].trial_expires_at.getTime()).toBeGreaterThanOrEqual(before + 14 * 86400000);
    const later = "2030-06-15T12:30:00.000Z";
    await admin.query("update tenants set trial_expires_at = $1 where id = $2", [later, result.tenantId]);
    expect((await getLead(leadId))?.trialExpiresAt?.toISOString()).toBe(later);
  });

  it("preserves the linked tenant and rejects relinking", async () => {
    const leadId = await lead();
    const provisioned = await convertLead(leadId, { slug: `link-${run}` }, { actorId });
    expect(provisioned.kind).toBe("ok");
    if (provisioned.kind !== "ok") return;
    const otherId = asTenantId(uuidv7());
    await admin.query("insert into tenants (id, slug, name, status) values ($1, $2, 'Other', 'trial')", [otherId, `other-${run}`]);
    const attempt = await transitionLead(leadId, { status: "trial", trialTenantId: otherId }, { actorId });
    expect(attempt.kind).toBe("error");
    expect((await getLead(leadId))?.trialTenantId).toBe(provisioned.tenantId);
    const retry = await convertLead(leadId, { slug: `retry-${run}` }, { actorId });
    expect(retry).toMatchObject({ kind: "error", code: "already_converted", tenantId: provisioned.tenantId });
  });

  it("returns a structured error on a duplicate slug", async () => {
    const one = await lead();
    const two = await lead();
    const slug = `duplicate-${run}`;
    expect((await convertLead(one, { slug }, { actorId })).kind).toBe("ok");
    expect(await convertLead(two, { slug }, { actorId })).toMatchObject({ kind: "error", code: "provision_failed" });
  });

  it("rolls back all domain writes when conversion audit insertion fails", async () => {
    const leadId = await lead();
    const slug = `audit-fail-${run}`;
    await admin.query(`create function ops_provision_audit_fail() returns trigger language plpgsql as $$
      begin if new.target_id = '${leadId}'::uuid and new.action = 'platform_lead.convert' then raise exception 'injected audit failure'; end if; return new; end $$`);
    await admin.query("create trigger ops_provision_audit_fail before insert on platform_audit_log for each row execute function ops_provision_audit_fail()");
    try {
      await expect(convertLead(leadId, { slug }, { actorId })).rejects.toThrow();
      expect((await admin.query("select id from tenants where slug = $1", [slug])).rows).toHaveLength(0);
      expect((await getLead(leadId))).toMatchObject({ status: "lead", trialTenantId: null });
      expect((await admin.query("select id from platform_audit_log where detail->>'slug' = $1", [slug])).rows).toHaveLength(0);
    } finally {
      await admin.query("drop trigger if exists ops_provision_audit_fail on platform_audit_log");
      await admin.query("drop function if exists ops_provision_audit_fail()");
    }
  });

  it("completes only the linked trial and audits the reason; converted cannot be reopened", async () => {
    const leadId = await lead();
    const provisioned = await convertLead(leadId, { slug: `complete-${run}` }, { actorId });
    expect(provisioned.kind).toBe("ok");
    if (provisioned.kind !== "ok") return;
    const tenantId = asTenantId(provisioned.tenantId);
    const suspended = asUserId(uuidv7());
    await admin.query(`insert into platform_users (id, email, name, password_hash, password_salt, role, status)
      values ($1, $2, 'Suspended', 'h', 's', 'admin', 'suspended')`, [suspended, `suspended-${run}@platform.test`]);
    expect((await markLeadConverted(leadId, tenantId, { actorId: suspended, reason: "Agreed" })).kind).toBe("error");
    expect((await markLeadConverted(leadId, tenantId, { actorId, reason: " " })).kind).toBe("error");
    expect((await markLeadConverted(leadId, asTenantId(uuidv7()), { actorId, reason: "Agreed" })).kind).toBe("error");
    expect((await markLeadConverted(leadId, tenantId, { actorId, reason: "Contract agreed" })).kind).toBe("ok");
    const audit = await admin.query("select detail from platform_audit_log where target_id = $1 and action = 'platform_lead.update' order by created_at desc", [leadId]);
    expect(audit.rows.some((row) => row.detail?.reason === "Contract agreed")).toBe(true);
    expect((await transitionLead(leadId, { status: "qualified" }, { actorId })).kind).toBe("error");
    expect((await getLead(leadId))?.status).toBe("converted");
  });

  it("rechecks operator authority after waiting for the lead lock", async () => {
    const leadId = await lead();
    const operator = asUserId(uuidv7());
    await admin.query(`insert into platform_users (id, email, name, password_hash, password_salt, role, status)
      values ($1, $2, 'Waiting operator', 'h', 's', 'admin', 'active')`, [operator, `wait-${run}@platform.test`]);
    const lock = await admin.connect();
    await lock.query("begin");
    await lock.query("select id from platform_leads where id = $1 for update", [leadId]);
    const pid = (await lock.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
    const pending = opsAction({ scope: "platform_lead.convert", actorId: operator, targetType: "platform_lead", targetId: leadId }, () => convertLead(leadId, { slug: `revoked-${run}` }, { actorId: operator }));
    try {
      await waitForBlocked(pid, 1);
      await admin.query("update platform_users set status = 'suspended' where id = $1", [operator]);
    } finally {
      await lock.query("commit");
      lock.release();
    }
    const result = await pending;
    expect(result.kind).toBe("error");
    expect((await admin.query("select id from tenants where slug = $1", [`revoked-${run}`])).rows).toHaveLength(0);
  });

  it("a queued generic transition cannot erase a freshly provisioned link", async () => {
    const leadId = await lead();
    const lock = await admin.connect();
    await lock.query("begin");
    await lock.query("select id from platform_leads where id = $1 for update", [leadId]);
    const pid = (await lock.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
    const provision = convertLead(leadId, { slug: `transition-race-${run}` }, { actorId });
    let transition: Promise<Awaited<ReturnType<typeof transitionLead>>> | undefined;
    try {
      await waitForBlocked(pid, 1);
      transition = transitionLead(leadId, { status: "qualified" }, { actorId });
      await waitForBlocked(pid, 2);
    } finally {
      await lock.query("commit");
      lock.release();
    }
    const created = await provision;
    await transition;
    expect(created.kind).toBe("ok");
    if (created.kind === "ok") expect((await getLead(leadId))?.trialTenantId).toBe(created.tenantId);
  }, 15_000);

  it("refuses a generic transition from a suspended administrator", async () => {
    const leadId = await lead();
    const operator = asUserId(uuidv7());
    await admin.query(`insert into platform_users (id, email, name, password_hash, password_salt, role, status)
      values ($1, $2, 'Suspended operator', 'h', 's', 'admin', 'suspended')`, [operator, `transition-denied-${run}@platform.test`]);
    expect((await transitionLead(leadId, { status: "qualified" }, { actorId: operator })).kind).toBe("error");
    expect((await getLead(leadId))?.status).toBe("lead");
  });
});
