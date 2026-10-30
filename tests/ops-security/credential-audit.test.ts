// @vitest-environment node
import { randomBytes } from "node:crypto";
import { v7 as uuid } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
import { sha256 } from "@/db/platform-auth-crypto";
import { seedRoleTemplates } from "@/lib/services/roles";
import { asTenantId } from "@/lib/ids";
import { deleteAuditRows } from "../helpers/audit-log-cleanup";
import { issueOwnerLoginLinkAction, issueOwnerResetLinkAction } from "@/lib/actions/platform-login-link";

const { cookies } = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => cookies.has(name) ? { name, value: cookies.get(name) } : undefined,
}) }));

const tenantA = uuid(), tenantB = uuid(), actor = uuid(), viewer = uuid();
const ownerA = uuid(), ownerB = uuid(), coachA = uuid();
const userA = uuid(), userB = uuid(), userC = uuid();
const run = Date.now().toString();
const phoneA = `+9198${run.slice(-8)}`, phoneB = `+9197${run.slice(-8)}`;
const phoneC = `+9196${run.slice(-8)}`;
const sessions = new Map<string, string>();

beforeAll(async () => {
  for (const [id, suffix] of [[tenantA, "a"], [tenantB, "b"]]) {
    await admin.query("insert into tenants(id,slug,name,status) values($1,$2,'Security fixture','active')", [id, `sec-${run}-${suffix}`]);
    await seedRoleTemplates(asTenantId(id!));
  }
  for (const [id, role] of [[actor, "admin"], [viewer, "viewer"]]) {
    await admin.query("insert into platform_users(id,email,name,password_hash,password_salt,role) values($1,$2,'Fixture','unused','unused',$3)", [id, `${id}@security.test`, role]);
    const token = randomBytes(32).toString("hex");
    sessions.set(id!, token);
    await admin.query("insert into platform_sessions(user_id,token_hash,second_factor_passed,expires_at) values($1,$2,true,now()+interval '1 hour')", [id, sha256(token)]);
  }
  for (const [id, phone] of [[userA, phoneA], [userB, phoneB], [userC, phoneC]]) {
    await admin.query("insert into users(id,phone) values($1,$2)", [id, phone]);
  }
  for (const [id, tenant, user, role] of [[ownerA, tenantA, userA, "owner"], [ownerB, tenantB, userB, "owner"], [coachA, tenantA, userC, "coach"]]) {
    await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status) select $1,$2,$3,id,'active' from roles where tenant_id=$2 and key=$4", [id, tenant, user, role]);
  }
});
beforeEach(() => cookies.set("platform_session", sessions.get(actor)!));
afterAll(async () => {
  await admin.query("drop trigger if exists security_audit_fault on platform_audit_log");
  await admin.query("drop function if exists security_audit_fault()");
  await deleteAuditRows(admin, "tenant_id=any($1::uuid[])", [[tenantA, tenantB]]);
  await admin.query("delete from platform_audit_log where actor_id=any($1::uuid[])", [[actor, viewer]]);
  await admin.query("delete from platform_sessions where user_id=any($1::uuid[])", [[actor, viewer]]);
  await admin.query("delete from platform_users where id=any($1::uuid[])", [[actor, viewer]]);
  await admin.query("delete from tenant_memberships where tenant_id=any($1::uuid[])", [[tenantA, tenantB]]);
  await admin.query("delete from role_permissions where tenant_id=any($1::uuid[])", [[tenantA, tenantB]]);
  await admin.query("delete from roles where tenant_id=any($1::uuid[])", [[tenantA, tenantB]]);
  await admin.query("delete from tenants where id=any($1::uuid[])", [[tenantA, tenantB]]);
  await admin.query("delete from users where id=any($1::uuid[])", [[userA, userB, userC]]);
  cookies.clear();
  await admin.end();
});

describe("Ops credential issuance — real session, permission and database audit", () => {
  it.each([
    ["login", issueOwnerLoginLinkAction, "tenant.owner_login_link.issue"],
    ["reset", issueOwnerResetLinkAction, "tenant.owner_reset_link.issue"],
  ] as const)("audits %s issuance on both channels, identifies the issuer, and never stores the credential", async (_, issue, action) => {
    const result = await issue({ tenantId: tenantA, phone: phoneA });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const platform = (await admin.query("select * from platform_audit_log where actor_id=$1 and tenant_id=$2 and action=$3", [actor, tenantA, action])).rows;
    expect(platform).toHaveLength(1);
    expect(platform[0]).toMatchObject({ target_type: "tenant_membership", target_id: ownerA });
    expect(platform[0].detail).toMatchObject({ purpose: result.purpose, expiresAt: result.expiresAt.toISOString() });
    const tenant = (await admin.query("select * from audit_log where tenant_id=$1 and entity_id=$2 and action=$3", [tenantA, ownerA, action])).rows;
    expect(tenant).toHaveLength(1);
    expect(tenant[0]).toMatchObject({ actor_type: "platform", actor_id: null, source: "ops" });
    expect(tenant[0].after).toMatchObject({ platformActorId: actor });
    expect(JSON.stringify([...platform, ...tenant])).not.toContain(result.token);
    expect(JSON.stringify([...platform, ...tenant])).not.toContain(result.urlPath);
  });

  it("refuses viewer, unauthenticated and guessed other-tenant targets without issuance audits, and traces the refusal", async () => {
    // The credential issuance rows are the ones that claim a credential
    // exists. A refusal must not add one.
    const issuanceActions = ["tenant.owner_login_link.issue", "tenant.owner_reset_link.issue"];
    const countIssuance = async (): Promise<number> =>
      (await admin.query(
        "select count(*)::int n from platform_audit_log where action = any($1::text[])",
        [issuanceActions],
      )).rows[0]!.n;
    const before = await countIssuance();

    cookies.set("platform_session", sessions.get(viewer)!);
    expect((await issueOwnerLoginLinkAction({ tenantId: tenantA, phone: phoneA })).kind).toBe("error");
    cookies.clear();
    expect((await issueOwnerResetLinkAction({ tenantId: tenantA, phone: phoneA })).kind).toBe("error");
    cookies.set("platform_session", sessions.get(actor)!);
    expect((await issueOwnerLoginLinkAction({ tenantId: tenantA, phone: phoneB })).kind).toBe("error");
    expect((await issueOwnerResetLinkAction({ tenantId: tenantA, phone: phoneC })).kind).toBe("error");
    expect((await issueOwnerResetLinkAction({ tenantId: "invalid", phone: phoneA })).kind).toBe("error");

    // NO issuance audit was written for any of the five refusals: the
    // count of credential issuance rows is unchanged.
    expect(await countIssuance()).toBe(before);

    // And no credential audit reached the tenant trail either: the
    // guessed other-tenant owner and the non-owner coach are not audit
    // targets of a refusal.
    const tenantRows = await admin.query(
      "select 1 from audit_log where entity_id = any($1::uuid[]) and action = any($2::text[])",
      [[ownerB, coachA], issuanceActions],
    );
    expect(tenantRows.rows).toHaveLength(0);
    const platformTargets = await admin.query(
      "select 1 from platform_audit_log where target_id = any($1::uuid[]) and action = any($2::text[])",
      [[ownerB, coachA], issuanceActions],
    );
    expect(platformTargets.rows).toHaveLength(0);

    // The REFUSAL is traced, not silent: an identified operator's refusal
    // leaves exactly ONE bounded row that names the operation and the
    // outcome, and no credential.
    const viewerRows = await admin.query<{ action: string; detail: { outcome?: string } }>(
      "select action, detail from platform_audit_log where actor_id = $1",
      [viewer],
    );
    expect(viewerRows.rows).toHaveLength(1);
    expect(viewerRows.rows[0]!.action).toBe("ops.operation.tenant.owner_login_link.issue");
    expect(viewerRows.rows[0]!.detail).toMatchObject({ outcome: "denied" });

    // The ANONYMOUS refusal leaves nothing: an unauthenticated caller is
    // not an Ops operation and cannot write to the audit log.
    const anonymous = await admin.query(
      "select 1 from platform_audit_log where action = 'ops.operation.tenant.owner_reset_link.issue' and actor_id is null",
    );
    expect(anonymous.rows).toHaveLength(0);

    // The admin's own refusals are traced too, with the outcome that
    // describes them: the guessed other-tenant target and the non-owner
    // are ERRORS, the malformed tenant id is INVALID.
    const actorTraces = await admin.query<{ action: string; detail: { outcome?: string } }>(
      "select action, detail from platform_audit_log where actor_id = $1 and action like 'ops.operation.%'",
      [actor],
    );
    expect(actorTraces.rows).toHaveLength(3);
    expect(actorTraces.rows.map((row) => row.detail.outcome).sort()).toEqual([
      "error",
      "error",
      "invalid",
    ]);

    // No credential material in any of them.
    const payload = JSON.stringify([...viewerRows.rows, ...actorTraces.rows]);
    expect(payload.includes(phoneA)).toBe(false);
    expect(payload.includes(phoneB)).toBe(false);
    expect(payload.includes(phoneC)).toBe(false);
    expect(payload.includes("login/link/")).toBe(false);
  });

  it("returns no bearer credential when audit persistence fails and rolls back both channels", async () => {
    const before = (await admin.query("select count(*)::int n from audit_log where tenant_id=$1", [tenantA])).rows[0].n;
    await admin.query(`create function security_audit_fault() returns trigger language plpgsql as $$ begin
      if new.actor_id = '${actor}'::uuid then raise exception 'security audit fixture failure'; end if;
      return new; end $$`);
    await admin.query("create trigger security_audit_fault before insert on platform_audit_log for each row execute function security_audit_fault()");
    try {
      await expect(issueOwnerLoginLinkAction({ tenantId: tenantA, phone: phoneA })).rejects.toThrow();
      expect((await admin.query("select count(*)::int n from audit_log where tenant_id=$1", [tenantA])).rows[0].n).toBe(before);
    } finally {
      await admin.query("drop trigger security_audit_fault on platform_audit_log");
      await admin.query("drop function security_audit_fault()");
    }
  });
});
