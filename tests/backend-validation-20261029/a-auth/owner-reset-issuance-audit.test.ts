// @vitest-environment node
//
// Lane a-auth — the tenant-side owner-reset ISSUANCE audit (F2).
//
// STATUS: SUPPLEMENTARY BASELINE assertions for the DOCUMENTED requirement.
//
// These assertions PASS on the current code and are NOT an intended RED.
// The documented requirement (docs/ops-authenticator-cutover.md):
//
//   "Issuance writes platform and tenant audits in the issuance
//    transaction before a bearer credential is returned. The audit
//    records actor, target, purpose and expiry, excluding the
//    credential itself."
//
// The baseline already satisfies the observable half of that: when the
// audit write fails, the issuance reports failure and no credential is
// RETURNED. These tests pin that, so a future change cannot quietly
// start returning a credential whose audit did not commit.
//
// Historical record (kept honestly): an earlier version of this file
// asserted that no bearer credential is MINTED INTERNALLY when the audit
// fails. That expectation is STRONGER than the documented requirement
// (which is about the credential being RETURNED), and the earlier
// implementation signed the token before the audit — so that assertion
// failed with "expected length 0, received 1" (1 failed | 2 passed).
// It is NOT evidence of credential leakage: the baseline already
// withholds the external return, and the minted-but-discarded token was
// never observable to a caller. The assertion is withdrawn, and the
// transaction-alignment hardening it was measuring is proposed, not
// landed (see docs/audits/backend-validation-20261029/lanes/a-auth/
// proposals/protected-and-open-items.md, F2).
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own services
// on the app_login runtime connection.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";
import { db } from "@/db/client";
import { withPlatform } from "@/db/scope";
import { users } from "@/db/schema/users";
import { seedRoleTemplates } from "@/lib/services/roles";
import { issueTenantOwnerResetLink } from "@/lib/services/owner-reset";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const phone = (suffix: string) => `+91982${RUN_NUM}${suffix}`;

let tenantId: TenantId = asTenantId("");
let ownerMembershipId = "";
let ownerUserId: UserId = asUserId("");

async function armAuditFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_owner_reset_audit_fault on audit_log");
  await admin.query("drop function if exists a_auth_owner_reset_audit_fault()");
  await admin.query(`create function a_auth_owner_reset_audit_fault() returns trigger language plpgsql as $$ begin
      if new.action = 'owner.reset_link_issued' then raise exception 'a-auth owner reset audit fault'; end if;
      return new; end $$`);
  await admin.query(
    "create trigger a_auth_owner_reset_audit_fault before insert on audit_log for each row execute function a_auth_owner_reset_audit_fault()",
  );
}

async function disarmAuditFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_owner_reset_audit_fault on audit_log");
  await admin.query("drop function if exists a_auth_owner_reset_audit_fault()");
}

/** The expiry the credential carries, read back from its own claims. */
function claimsExpiry(token: string): number {
  const payload = token.split(".")[1] ?? "";
  const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return (JSON.parse(json) as { exp: number }).exp;
}

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'a-auth owner reset audit', $3, 'Asia/Kolkata')",
    [tenantId, `a-auth-owner-reset-${RUN}`, plan?.id ?? null],
  );
  await seedRoleTemplates(tenantId);
  const roleRow = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1::uuid and key = 'owner'",
    [tenantId],
  );
  const userId = asUserId(uuidv7());
  await withPlatform(async () => {
    await db.insert(users).values({ id: userId, phone: phone("01") });
  });
  ownerMembershipId = uuidv7();
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
     values ($1, $2::uuid, $3, $4, 'active')`,
    [ownerMembershipId, tenantId, userId, roleRow.rows[0]!.id],
  );
  ownerUserId = userId;
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
  await admin.query("delete from users where phone = $1", [phone("01")]);
  await admin.end();
});

describe("the owner-reset issuance audit", () => {
  it("records the actor, the target and the expiry, and no credential material", async () => {
    const result = await issueTenantOwnerResetLink(
      { tenantId, userId: ownerUserId, roleKey: "owner" },
      ownerMembershipId,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const audit = await admin.query<{
      action: string;
      actor_id: string;
      entity_id: string;
      after: Record<string, unknown>;
    }>(
      "select action, actor_id, entity_id, after from audit_log where tenant_id = $1::uuid and action = 'owner.reset_link_issued' order by created_at desc limit 1",
      [tenantId],
    );
    expect(audit.rows).toHaveLength(1);
    const row = audit.rows[0]!;
    expect(row.actor_id).toBe(ownerUserId);
    expect(row.entity_id).toBe(ownerMembershipId);
    // The expiry the audit records is the expiry the credential carries.
    expect(new Date(String(row.after.expiresAt)).getTime()).toBe(claimsExpiry(result.token) * 1000);
    // The credential itself is never recorded.
    expect(JSON.stringify(row.after)).not.toContain(result.token);
  });

  it("fails the issuance and returns NO credential when the audit cannot be written", async () => {
    const before = await admin.query<{ n: number }>(
      "select count(*)::int as n from audit_log where tenant_id = $1::uuid and action = 'owner.reset_link_issued'",
      [tenantId],
    );
    await armAuditFault();
    let failed = false;
    let token: string | null = null;
    try {
      const result = await issueTenantOwnerResetLink(
        { tenantId, userId: ownerUserId, roleKey: "owner" },
        ownerMembershipId,
      );
      failed = result.kind === "error";
      if (result.kind === "ok") token = result.token;
    } catch {
      failed = true;
    } finally {
      await disarmAuditFault();
    }
    expect(failed).toBe(true);
    expect(token).toBeNull();

    const after = await admin.query<{ n: number }>(
      "select count(*)::int as n from audit_log where tenant_id = $1::uuid and action = 'owner.reset_link_issued'",
      [tenantId],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("a target that does not exist in this tenant is refused and writes no audit row", async () => {
    // ONE id, used for the call AND the audit query. The earlier version
    // of this assertion passed two different random uuids, so the query
    // could never match and the assertion was vacuous — it could not
    // have failed whatever the implementation did. It was never a RED,
    // and its earlier green proved nothing about the audit.
    const missingMembershipId = uuidv7();
    const result = await issueTenantOwnerResetLink(
      { tenantId, userId: ownerUserId, roleKey: "owner" },
      missingMembershipId,
    );
    expect(result).toMatchObject({ kind: "error", code: "membership_not_found" });
    const audit = await admin.query(
      "select 1 from audit_log where tenant_id = $1::uuid and action = 'owner.reset_link_issued' and entity_id = $2::uuid",
      [tenantId, missingMembershipId],
    );
    expect(audit.rows).toHaveLength(0);
  });
});
