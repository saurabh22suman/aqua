// @vitest-environment node
//
// Lane a-auth — the Ops sign-out audit (F8). STATUS: IMPLEMENTED AND GREEN.
//
// The human-approved patch was applied to db/platform-auth.ts; the applied
// file is sha256 5c0314c9e1a6cde1bc8d304a04932a7a34a189429f0660aab2f49790721ac23b
// (patch sha256 e5d37c0c44cc63388666de7490355829bab1ab4b39c779484096a736fc9d788c,
// authorised at docs/audits/backend-validation-20261029/a-auth/proposals/
// backend-ops-logout-audit-proposed.patch).
//
// HISTORY — the intended RED, captured before the patch was applied and NOT
// re-run after it (provenance: evidence/README.md and
// evidence/a-auth-f8-platform-logout-intended-red-20261029.log):
//
//   3 failed | 1 passed (4) — vitest Start at 02:28:07
//     × records exactly one platform.logout audit naming the operator as the actor
//       "expected 1, received 0"
//     × a repeated sign-out with the same token writes no second audit row
//       (the "exactly one" precondition)
//     × when the audit write fails the session survives
//       "promise resolved 'undefined' instead of rejecting"
//
// GREEN command:
//   python3 .opencode/scripts/lane_job.py harness test tests/backend-validation-20261029/a-auth/platform-logout-audit.test.ts
//
// Why the audit was owed: scripts/lib/ops-action-scan.ts:26 exempts
// logoutPlatformAction from the opsAction pipeline with the reason
// "session teardown: audited by db/platform-auth.ts (platform.logout)",
// and no such row was written anywhere.
//
// The acceptance:
//   1. a sign-out that actually removed a session records exactly ONE
//      platform.logout audit row, naming the operator as the actor;
//   2. the row carries no token, hash, password or code;
//   3. a repeated sign-out with the same token, and a sign-out with an
//      unknown token, write NO audit row;
//   4. when the audit write fails, the session survives (the deletion
//      rolls back with it);
//   5. two CONCURRENT sign-outs with the same token remove the session once
//      and write exactly one audit row (supplementary coverage of the
//      existing atomic implementation — not a new intended RED).
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own code on
// the app_login runtime connection.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { platformLogout } from "@/db/platform-auth";
import { sha256 } from "@/db/platform-auth-crypto";

let operatorId = "";
let operatorEmail = "";
let sessionId = "";
let token = "";

async function armLogoutAuditFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_logout_audit_fault on platform_audit_log");
  await admin.query("drop function if exists a_auth_logout_audit_fault()");
  // Scoped to THIS fixture's operator as well as the action, so an
  // unrelated writer of platform.logout on the shared disposable DB is
  // not failed by this window.
  await admin.query(`create function a_auth_logout_audit_fault() returns trigger language plpgsql as $$ begin
      if new.action = 'platform.logout' and new.actor_id = '${operatorId}'::uuid then
        raise exception 'a-auth logout audit fault';
      end if;
      return new; end $$`);
  await admin.query(
    "create trigger a_auth_logout_audit_fault before insert on platform_audit_log for each row execute function a_auth_logout_audit_fault()",
  );
}

async function disarmLogoutAuditFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_logout_audit_fault on platform_audit_log");
  await admin.query("drop function if exists a_auth_logout_audit_fault()");
}

async function logoutAudits(): Promise<{ n: number }[]> {
  return (
    await admin.query<{ n: number }>(
      "select count(*)::int as n from platform_audit_log where action = 'platform.logout'",
    )
  ).rows;
}

async function sessionRows(): Promise<{ n: number }[]> {
  return (
    await admin.query<{ n: number }>(
      "select count(*)::int as n from platform_sessions where id = $1",
      [sessionId],
    )
  ).rows;
}

beforeAll(async () => {
  operatorId = randomUUID();
  operatorEmail = `a-auth-logout-${operatorId}@example.test`;
  await admin.query(
    "insert into platform_users(id,email,name,password_hash,password_salt,totp_secret,totp_enrolled) values($1,$2,'Logout fixture','unused','unused','JBSWY3DPEHPK3PXP',true)",
    [operatorId, operatorEmail],
  );
});

beforeEach(async () => {
  await disarmLogoutAuditFault();
  await admin.query("delete from platform_audit_log where action = 'platform.logout'");
  await admin.query("delete from platform_sessions where user_id = $1", [operatorId]);
  sessionId = randomUUID();
  token = `a-auth-logout-token-${randomUUID()}`;
  await admin.query(
    "insert into platform_sessions(id,user_id,token_hash,expires_at) values($1,$2,$3, now() + interval '8 hours')",
    [sessionId, operatorId, sha256(token)],
  );
});

afterAll(async () => {
  await disarmLogoutAuditFault();
  await admin.query("delete from platform_audit_log where action = 'platform.logout'");
  await admin.query("delete from platform_sessions where user_id = $1", [operatorId]);
  await admin.query("delete from platform_users where id = $1", [operatorId]);
  await admin.end();
});

describe("the Ops sign-out audit (F8 — implemented and green)", () => {
  it("records exactly one platform.logout audit naming the operator as the actor", async () => {
    await platformLogout(token);

    const rows = await admin.query<{
      action: string;
      actor_id: string | null;
      detail: Record<string, unknown>;
    }>(
      "select action, actor_id, detail from platform_audit_log where action = 'platform.logout'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.actor_id).toBe(operatorId);
    // No token, hash, password or code may appear in the audit row.
    const payload = JSON.stringify(rows.rows[0]);
    expect(payload).not.toContain(token);
    expect(payload).not.toContain(sha256(token));
    expect(payload).not.toContain("unused");
  });

  it("a repeated sign-out with the same token writes no second audit row", async () => {
    await platformLogout(token);
    const afterFirst = await logoutAudits();
    expect(afterFirst[0]!.n).toBe(1);

    await platformLogout(token);
    const afterSecond = await logoutAudits();
    expect(afterSecond[0]!.n).toBe(1);
  });

  it("a sign-out with an unknown token writes no audit row", async () => {
    await platformLogout(`never-issued-${randomUUID()}`);
    expect((await logoutAudits())[0]!.n).toBe(0);
  });

  it("two concurrent sign-outs with the same token remove the session once and write ONE audit row", async () => {
    // Supplementary coverage of the existing atomic implementation: the
    // single DELETE ... RETURNING inside one transaction means the second
    // concurrent call blocks on the row lock, re-evaluates, deletes zero
    // rows and writes no audit. Not a new intended RED.
    const before = (await sessionRows())[0]!.n;
    expect(before).toBe(1);

    await Promise.all([platformLogout(token), platformLogout(token)]);

    expect((await sessionRows())[0]!.n).toBe(0);
    const audits = await admin.query<{ actor_id: string | null }>(
      "select actor_id from platform_audit_log where action = 'platform.logout'",
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]!.actor_id).toBe(operatorId);
  });

  it("when the audit write fails the session survives (the deletion rolls back)", async () => {
    await armLogoutAuditFault();
    await expect(platformLogout(token)).rejects.toThrow();
    await disarmLogoutAuditFault();

    expect((await sessionRows())[0]!.n).toBe(1);
    expect((await logoutAudits())[0]!.n).toBe(0);
  });
});
