// @vitest-environment node
//
// Lane a-auth — ATOMIC acceptance for the reset redemption's audit.
//
// STATUS: IMPLEMENTED AND GREEN.
//
// This file is the acceptance for the atomic boundary the coordinator
// asked for. The atomic implementation landed in
// lib/services/invite-link.ts (one transaction carrying the credential
// rotation, the session revocation and the platform_audit_log row) and
// this file is its acceptance.
//
// The intended RED was captured BEFORE that implementation and is
// retained (not re-run): 2 failed | 10 passed (12) — "writes an audit row
// with no secret in the payload — expected 1, received 0" and "rolls the
// credential rotation and the session revocation back when the audit
// write fails — expected true, received false" (the redemption reported
// success with no audit at all). Provenance:
// docs/audits/backend-validation-20261029/lanes/a-auth/evidence/README.md
//
// GREEN command:
//   python3 .opencode/scripts/lane_job.py harness test tests/backend-validation-20261029/a-auth
//
// The design and its residuals are written up in
// docs/audits/backend-validation-20261029/lanes/a-auth/proposals/atomic-reset-audit.md
// (the atomic unit is credential + revocation + audit; the link consumption
// and the session mint stay outside it).
//
// The last case in this file is the A2 acceptance from the independent
// review: the audit row must say whether the credential was actually
// rotated, so a PIN-less reset does not read as a PIN reset.

// The acceptance (both halves must hold):
//
//   1. a successful reset redemption writes an audit row that records
//      the credential rotation and the session revocation, with no
//      secret in the payload; and
//   2. when that audit write FAILS, the credential rotation and the
//      session revocation ROLL BACK — the owner's old PIN still signs
//      in and their live sessions still resolve.
//
// Why a failure injection rather than a "a row exists" assertion: a
// non-atomic audit insert satisfies (1) while completely failing (2).
// The bug this acceptance exists for is precisely that shape.
//
// The failure is injected with a real database trigger (the same
// technique tests/ops-security/login-protection.test.ts uses), not with
// a mock: the point is to prove the ROLLBACK of the credential and
// session writes, which a mocked assertion cannot show.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own
// services on the app_login runtime connection.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";
import { db } from "@/db/client";
import { withPlatform } from "@/db/scope";
import { users } from "@/db/schema/users";
import { baUser } from "@/db/schema/better-auth";
import { seedRoleTemplates } from "@/lib/services/roles";
import { issueOwnerResetLink } from "@/lib/services/invite-link-issue";
import { redeemLoginLink } from "@/lib/services/invite-link";
import { pinLogin, setCredential } from "@/lib/services/credentials";
import { auth } from "@/lib/auth/server";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const phone = (suffix: string) => `+91986${RUN_NUM}${suffix}`;

let tenantId: TenantId = asTenantId("");
let ownerMembershipId = "";
let ownerUserId: UserId = asUserId("");
let ownerBaId = "";

async function plantSession(baUserId: string, label: string): Promise<string> {
  const token = `${label}-${uuidv7()}`;
  await admin.query(
    `insert into ba_session (id, user_id, token, expires_at, created_at, updated_at)
     values ($1, $2, $3, now() + interval '7 days', now(), now())`,
    [uuidv7(), baUserId, token],
  );
  return token;
}

async function sessionExists(token: string): Promise<boolean> {
  const rows = await admin.query<{ n: number }>(
    "select count(*)::int as n from ba_session where token = $1",
    [token],
  );
  return (rows.rows[0]?.n ?? 0) > 0;
}

async function sessionResolves(token: string): Promise<boolean> {
  const baCtx = await auth.$context;
  const signature = createHmac("sha256", baCtx.secret).update(token).digest("base64");
  const headers = new Headers();
  headers.set("cookie", `${baCtx.authCookies.sessionToken.name}=${token}.${signature}`);
  const session = await withPlatform(() => auth.api.getSession({ headers }));
  return !!session?.user;
}

/**
 * Make the reset audit write fail at the database, for real. The
 * trigger fires only for the reset action so nothing else is disturbed.
 */
async function armAuditFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_reset_audit_fault on platform_audit_log");
  await admin.query("drop function if exists a_auth_reset_audit_fault()");
  await admin.query(`create function a_auth_reset_audit_fault() returns trigger language plpgsql as $$ begin
      if new.action = 'credentials.pin_reset' then raise exception 'a-auth reset audit fault'; end if;
      return new; end $$`);
  await admin.query(
    "create trigger a_auth_reset_audit_fault before insert on platform_audit_log for each row execute function a_auth_reset_audit_fault()",
  );
}

async function disarmAuditFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_reset_audit_fault on platform_audit_log");
  await admin.query("drop function if exists a_auth_reset_audit_fault()");
}

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'a-auth atomic audit test', $3, 'Asia/Kolkata')",
    [tenantId, `a-auth-atomic-${RUN}`, plan?.id ?? null],
  );
  await seedRoleTemplates(tenantId);

  const roleRow = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1::uuid and key = 'owner'",
    [tenantId],
  );
  const userId = asUserId(uuidv7());
  const p = phone("01");
  await withPlatform(async () => {
    await db.insert(users).values({ id: userId, phone: p });
  });
  const baId = uuidv7();
  await withPlatform(async () => {
    await db.insert(baUser).values({
      id: baId,
      name: p,
      email: `${p}@phone.aqua.local`,
      phoneNumber: p,
      phoneNumberVerified: true,
    });
  });
  ownerMembershipId = uuidv7();
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
     values ($1, $2::uuid, $3, $4, 'active')`,
    [ownerMembershipId, tenantId, userId, roleRow.rows[0]!.id],
  );
  ownerUserId = userId;
  ownerBaId = baId;
});

afterAll(async () => {
  await disarmAuditFault();
  if (tenantId) {
    await deleteAuditRowsForTenant(admin, tenantId);
    await admin.query("delete from invite_link_uses where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenant_memberships where tenant_id = $1", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  const p = phone("01");
  await admin.query(
    "delete from ba_session where user_id in (select id from ba_user where phone_number = $1)",
    [p],
  );
  await admin.query(
    "delete from ba_account where user_id in (select id from ba_user where phone_number = $1)",
    [p],
  );
  await admin.query("delete from ba_user where phone_number = $1", [p]);
  await admin.query("delete from users where phone = $1", [p]);
  await admin.query("delete from platform_audit_log where target_id = $1::uuid", [ownerUserId]);
  await admin.end();
});

describe("a reset redemption's audit is atomic with the credential and session changes", () => {
  it("writes an audit row with no secret in the payload", async () => {
    await setCredential(ownerBaId, "111111");
    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup: reset link was not issued");
    const redeemed = await redeemLoginLink(issued.token, { pin: "999999" });
    expect(redeemed.kind).toBe("ok");

    const rows = await admin.query<{
      action: string;
      target_type: string | null;
      target_id: string | null;
      detail: Record<string, unknown>;
    }>(
      `select action, target_type, target_id, detail from platform_audit_log
       where action = 'credentials.pin_reset' and target_id = $1::uuid
       order by created_at desc`,
      [ownerUserId],
    );
    expect(rows.rows.length).toBe(1);
    const row = rows.rows[0]!;
    expect(row.target_type).toBe("user");
    expect(row.target_id).toBe(ownerUserId);
    const payload = JSON.stringify(row.detail);
    expect(payload).not.toContain("999999");
    expect(payload).not.toContain("111111");
    expect(payload).not.toContain(phone("01"));
    expect(payload).not.toContain(issued.token);
  });

  it("rolls the credential rotation and the session revocation back when the audit write fails", async () => {
    await setCredential(ownerBaId, "111111");
    const deviceA = await plantSession(ownerBaId, "atomic-device-a");
    const deviceB = await plantSession(ownerBaId, "atomic-device-b");

    const issued = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (issued.kind !== "ok") throw new Error("setup: reset link was not issued");

    await armAuditFault();
    let failed = false;
    try {
      const redeemed = await redeemLoginLink(issued.token, { pin: "999999" });
      failed = redeemed.kind === "error";
    } catch {
      failed = true;
    } finally {
      await disarmAuditFault();
    }
    // The redemption must not report success when its audit could not
    // be written.
    expect(failed).toBe(true);

    // And the credential rotation and the session revocation must have
    // rolled back with it.
    const oldPin = await pinLogin(phone("01"), "111111");
    expect(oldPin.status).toBe(200);
    const newPin = await pinLogin(phone("01"), "999999");
    expect(newPin.status).toBeGreaterThanOrEqual(400);
    expect(await sessionExists(deviceA)).toBe(true);
    expect(await sessionExists(deviceB)).toBe(true);
    expect(await sessionResolves(deviceA)).toBe(true);
  });
});

describe("the reset audit records what actually happened", () => {
  it("says whether the credential was rotated (A2, independent review)", async () => {
    await setCredential(ownerBaId, "111111");
    // Count this owner's existing rows first: an earlier case in this
    // file already wrote one, so the assertion is about the rows THIS
    // case creates.
    const before = await admin.query<{ n: number }>(
      "select count(*)::int as n from platform_audit_log where action = 'credentials.pin_reset' and target_id = $1::uuid",
      [ownerUserId],
    );
    const withPin = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (withPin.kind !== "ok") throw new Error("setup: reset link was not issued");
    const rotated = await redeemLoginLink(withPin.token, { pin: "999999" });
    expect(rotated.kind).toBe("ok");

    const withoutPin = await issueOwnerResetLink(tenantId, ownerMembershipId);
    if (withoutPin.kind !== "ok") throw new Error("setup: reset link was not issued");
    const revokedOnly = await redeemLoginLink(withoutPin.token);
    expect(revokedOnly.kind).toBe("ok");

    const rows = await admin.query<{ detail: Record<string, unknown> }>(
      `select detail from platform_audit_log
       where action = 'credentials.pin_reset' and target_id = $1::uuid
       order by created_at asc`,
      [ownerUserId],
    );
    expect(rows.rows.length).toBe(before.rows[0]!.n + 2);
    const mine = rows.rows.slice(-2);
    // The reset that carried a PIN rotated the credential.
    expect(mine[0]!.detail.credentialRotated).toBe(true);
    // The reset without a PIN only revoked the sessions. The record must
    // say so, or the operator's evidence contradicts what happened.
    expect(mine[1]!.detail.credentialRotated).toBe(false);
  });
});
