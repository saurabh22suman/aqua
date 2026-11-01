// @vitest-environment node
//
// Lane a-auth — staging blocker F10: a staff credential issuance must not
// commit when its notification cannot be queued.
//
// WHY THIS IS A DEFECT (not an open product question)
//
// docs/whatsapp-demo-flows.md ("Connected event paths") lists
// "Staff invitations, resend and generated login links" among the events
// that notify the target membership's registered phone, and states the
// rule for every one of them:
//
//   "Events enqueue durable outbox rows and audits in the originating
//    transaction."
//
// The two sibling paths already obey it — lib/services/staff-invitations.ts
// calls enqueueInvitationNotification(tx, ...) INSIDE its withTenant
// transaction (inviteStaff, resendInvitation). The generated-login-link
// path did not: lib/actions/invite-link.ts issued the link (and committed
// its audit) in one transaction and enqueued the notification in a SECOND
// one.
//
// The observable consequence, reproduced here with a real database fault:
// when the outbox insert fails, the issuance and its audit are ALREADY
// committed, the action rejects with an unhandled database error, and the
// operator is told the operation failed while a credential exists that
// nobody received. A committed operation is reported as a failure, and
// the credential is lost.
//
// THE ACCEPTANCE
//
//   1. when the notification cannot be queued, the action reports a
//      bounded error result (it does not fail with an unhandled error);
//   2. nothing is committed: no staff.login_link_issued audit row, no
//      whatsapp.invitation.queued audit row and no outbox row survive
//      the failure;
//   3. the failure is recoverable: once the fault is gone the same call
//      succeeds and the trail holds EXACTLY ONE issuance, not two;
//   4. with a healthy outbox the issuance, its audit, the outbox row and
//      the whatsapp.invitation.queued audit all commit;
//   5. no audit row ever carries the bearer credential.
//
// EVIDENCE HYGIENE
//
// A failed database insert prints its own parameters, and those parameters
// contain the synthetic bearer link. The assertions below therefore report
// SAFE BOOLEANS only — never the error object — so no credential can reach
// a test log. The raw run logs live in the ignored, mode-0600
// evidence/raw/ directory; only redacted copies are published.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own code on
// the app_login runtime connection.
//
// GREEN command:
//   python3 .opencode/scripts/lane_job.py harness test \
//     tests/staging-blockers-20261029/a-auth/credential-notification-atomicity.test.ts

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";
import { db } from "@/db/client";
import { withPlatform } from "@/db/scope";
import { users } from "@/db/schema/users";
import { baUser } from "@/db/schema/better-auth";
import { seedRoleTemplates } from "@/lib/services/roles";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const phone = `+9198${RUN_NUM}77`;

let tenantId: TenantId = asTenantId("");
let targetMembershipId = "";
let targetUserId: UserId = asUserId("");
let issuerUserId: UserId = asUserId("");

async function armOutboxFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_f10_outbox_fault on whatsapp_notification_outbox");
  await admin.query("drop function if exists a_auth_f10_outbox_fault()");
  // Scoped to THIS fixture's tenant, so an unrelated writer of the
  // outbox on the shared disposable database is not failed by the
  // test window.
  await admin.query(`create function a_auth_f10_outbox_fault() returns trigger language plpgsql as $$ begin
      if new.tenant_id = '${tenantId}'::uuid then
        raise exception 'a-auth outbox fault';
      end if;
      return new; end $$`);
  await admin.query(
    "create trigger a_auth_f10_outbox_fault before insert on whatsapp_notification_outbox for each row execute function a_auth_f10_outbox_fault()",
  );
}

async function disarmOutboxFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_f10_outbox_fault on whatsapp_notification_outbox");
  await admin.query("drop function if exists a_auth_f10_outbox_fault()");
}

async function countRows(sql: string, params: unknown[]): Promise<number> {
  const rows = await admin.query<{ n: number }>(sql, params);
  return rows.rows[0]!.n;
}

async function issuanceAudits(): Promise<number> {
  return countRows(
    "select count(*)::int as n from audit_log where tenant_id = $1::uuid and action = 'staff.login_link_issued'",
    [tenantId],
  );
}

async function notificationAudits(): Promise<number> {
  return countRows(
    "select count(*)::int as n from audit_log where tenant_id = $1::uuid and action = 'whatsapp.invitation.queued'",
    [tenantId],
  );
}

async function outboxRows(): Promise<number> {
  return countRows(
    "select count(*)::int as n from whatsapp_notification_outbox where tenant_id = $1::uuid",
    [tenantId],
  );
}

// The real action entry point. The authorization boundary
// (requireDefaultCtx + requirePermission) is proven by the existing
// suites; this file is about the transaction boundary of the issuance
// and its notification, so the authenticated context is injected.
async function loadAction(): Promise<
  (membershipId: string) => Promise<{ kind: string; urlPath?: string; message?: string }>
> {
  const ctx = {
    tenantId,
    userId: issuerUserId,
    roleKey: "owner",
    permissions: new Set(["staff.invite"]),
    features: new Set<string>(),
  };
  vi.doMock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ctx }));
  vi.resetModules();
  const mod = await import("@/lib/actions/invite-link");
  return mod.issueLoginLinkAction as unknown as (
    membershipId: string,
  ) => Promise<{ kind: string; urlPath?: string; message?: string }>;
}

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'a-auth f10 fixture', $3, 'Asia/Kolkata')",
    [tenantId, `a-auth-f10-${RUN}`, plan?.id ?? null],
  );
  await seedRoleTemplates(tenantId);

  const roleRow = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1::uuid and key = 'coach'",
    [tenantId],
  );

  targetUserId = asUserId(uuidv7());
  issuerUserId = asUserId(uuidv7());
  await withPlatform(async () => {
    await db.insert(users).values([
      { id: targetUserId, phone },
      { id: issuerUserId, phone: `+9198${RUN_NUM}88` },
    ]);
  });
  const baId = uuidv7();
  await withPlatform(async () => {
    await db.insert(baUser).values({
      id: baId,
      name: phone,
      email: `${phone}@phone.aqua.local`,
      phoneNumber: phone,
      phoneNumberVerified: true,
    });
  });
  targetMembershipId = uuidv7();
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
     values ($1, $2::uuid, $3, $4, 'active')`,
    [targetMembershipId, tenantId, targetUserId, roleRow.rows[0]!.id],
  );
});

beforeEach(async () => {
  // Each case starts from an empty trail for THIS tenant so the counts
  // below are absolute, not an artefact of the previous case.
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from whatsapp_notification_outbox where tenant_id = $1::uuid", [tenantId]);
});

afterAll(async () => {
  await disarmOutboxFault();
  vi.doUnmock("@/lib/auth/context");
  vi.resetModules();
  if (tenantId) {
    await deleteAuditRowsForTenant(admin, tenantId);
    await admin.query("delete from whatsapp_notification_outbox where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenant_memberships where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
  }
  await admin.query("delete from ba_user where phone_number = $1", [phone]);
  await admin.query("delete from users where phone = $1", [phone]);
  await admin.query("delete from users where phone = $1", [`+9198${RUN_NUM}88`]);
  await admin.end();
});

// Drives one issuance attempt with the outbox insert failing. The outcome
// is reported as SAFE BOOLEANS only: the underlying database error carries
// the attempted insert parameters, and those parameters contain the
// synthetic bearer link. Nothing here prints the error object.
async function attemptWithOutboxFault(
  issueLoginLinkAction: (membershipId: string) => Promise<{ kind: string; message?: string }>,
): Promise<{ escaped: boolean; kind: string | null }> {
  await armOutboxFault();
  let escaped = false;
  let kind: string | null = null;
  try {
    const result = await issueLoginLinkAction(targetMembershipId);
    kind = result.kind;
  } catch {
    escaped = true;
  } finally {
    await disarmOutboxFault();
  }
  return { escaped, kind };
}

describe("F10 — the generated login link and its notification share one transaction", () => {
  it("reports a bounded error instead of failing with an unhandled error", async () => {
    const issueLoginLinkAction = await loadAction();
    const outcome = await attemptWithOutboxFault(issueLoginLinkAction);

    // A bounded failure the operator can act on, not an unhandled error
    // escaping the action. The assertion is a boolean so no credential
    // bearing error payload can reach a log.
    expect(outcome.escaped, "the action must not fail with an unhandled error").toBe(false);
    expect(outcome.kind).toBe("error");
  });

  it("leaves no durable issuance record when the notification cannot be queued", async () => {
    const issueLoginLinkAction = await loadAction();
    await attemptWithOutboxFault(issueLoginLinkAction);

    // The issuance, its audit and the notification belong to ONE
    // transaction: a failure leaves nothing behind.
    expect(await issuanceAudits()).toBe(0);
    expect(await notificationAudits()).toBe(0);
    expect(await outboxRows()).toBe(0);
  });

  it("is recoverable: the trail holds exactly one issuance after a failure and a retry", async () => {
    const issueLoginLinkAction = await loadAction();
    await attemptWithOutboxFault(issueLoginLinkAction);

    const result = await issueLoginLinkAction(targetMembershipId);
    expect(result.kind).toBe("ok");

    // Exactly ONE issuance, not two: the failed attempt left no durable
    // record of its own.
    expect(await issuanceAudits()).toBe(1);
    expect(await notificationAudits()).toBe(1);
    expect(await outboxRows()).toBe(1);
  });

  it("never writes the bearer credential into an audit row", async () => {
    const issueLoginLinkAction = await loadAction();
    const result = await issueLoginLinkAction(targetMembershipId);
    expect(result.kind).toBe("ok");
    const issuedToken = (result.urlPath ?? "").split("/login/link/")[1] ?? "";
    expect(issuedToken).not.toBe("");

    const rows = await admin.query<{ action: string; after: unknown; before: unknown }>(
      "select action, after, before from audit_log where tenant_id = $1::uuid and action in ('staff.login_link_issued', 'whatsapp.invitation.queued')",
      [tenantId],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    const payload = JSON.stringify(rows.rows);
    expect(payload).not.toContain(issuedToken);
    expect(payload).not.toContain("/login/link/");
  });
});
