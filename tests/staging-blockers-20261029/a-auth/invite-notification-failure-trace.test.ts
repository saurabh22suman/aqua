// @vitest-environment node
//
// Lane a-auth — the F10 failure trace: a rolled-back issuance leaves exactly
// ONE bounded trace, and the authorized positive path still commits.
//
// The independent review of the F10 delta (coordinator-independent-review/
// independent-invite-atomicity-20261029T1210, finding R-1) found that the
// rollback removed EVERY row the attempt wrote, so a failed issuance left
// no trace at all: no audit row, no log line, no error object.
//
// The trace is written AFTER the rollback, in its OWN transaction, with a
// FIXED code. It never carries the cause, the message, the recipient's
// phone or the credential.
//
// These cases are agent-owned and live outside tests/tier1/**.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own services on
// the app_login runtime connection.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";
import { db } from "@/db/client";
import { withPlatform } from "@/db/scope";
import { users } from "@/db/schema/users";
import { baUser } from "@/db/schema/better-auth";
import { seedRoleTemplates } from "@/lib/services/roles";
import { issueLoginLink } from "@/lib/services/invite-link-issue";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const RUN_NUM = Date.now() % 1000000;
const phone = (suffix: string) => `+91983${RUN_NUM}${suffix}`;

let tenantId: TenantId = asTenantId("");
let issuerUserId: UserId = asUserId("");
let issuerBaId = "";
let membershipId = "";
let memberPhone = "";

async function armOutboxFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_trace_outbox_fault on whatsapp_notification_outbox");
  await admin.query("drop function if exists a_auth_trace_outbox_fault()");
  await admin.query(`create function a_auth_trace_outbox_fault() returns trigger language plpgsql as $$ begin
      raise exception 'a-auth notification fault';
      end $$`);
  await admin.query(
    "create trigger a_auth_trace_outbox_fault before insert on whatsapp_notification_outbox for each row execute function a_auth_trace_outbox_fault()",
  );
}

async function disarmOutboxFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_trace_outbox_fault on whatsapp_notification_outbox");
  await admin.query("drop function if exists a_auth_trace_outbox_fault()");
}

// The OTHER way the reviewed helper reports "not queued": it returns FALSE
// (no throw) when the outbox insert produced no row. A BEFORE INSERT
// trigger that returns NULL skips the row, so `INSERT ... RETURNING` yields
// nothing and the helper's own `if (!row) return false;` fires. This is a
// real database behaviour, not a mock.
async function armOutboxSkip(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_trace_outbox_skip on whatsapp_notification_outbox");
  await admin.query("drop function if exists a_auth_trace_outbox_skip()");
  await admin.query(`create function a_auth_trace_outbox_skip() returns trigger language plpgsql as $$ begin
      return null;
      end $$`);
  await admin.query(
    "create trigger a_auth_trace_outbox_skip before insert on whatsapp_notification_outbox for each row execute function a_auth_trace_outbox_skip()",
  );
}

async function disarmOutboxSkip(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_trace_outbox_skip on whatsapp_notification_outbox");
  await admin.query("drop function if exists a_auth_trace_outbox_skip()");
}

// The trace write itself can fail. Force it with a REAL BEFORE INSERT trigger
// on audit_log, SCOPED to the trace action: the issuance's own audit insert
// (which the rollback removes anyway) is unaffected, so the failure reaches
// `recordFailedNotificationTrace`'s catch and nothing else.
async function armTraceStoreFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_trace_store_fault on audit_log");
  await admin.query("drop function if exists a_auth_trace_store_fault()");
  await admin.query(`create function a_auth_trace_store_fault() returns trigger language plpgsql as $$ begin
      if new.action = 'staff.login_link_notification_failed' then
        raise exception 'a-auth trace store fault';
      end if;
      return new;
      end $$`);
  await admin.query(
    "create trigger a_auth_trace_store_fault before insert on audit_log for each row execute function a_auth_trace_store_fault()",
  );
}

async function disarmTraceStoreFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_trace_store_fault on audit_log");
  await admin.query("drop function if exists a_auth_trace_store_fault()");
}


async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await admin.query<{ n: number }>(sql, params);
  return rows.rows[0]!.n;
}

async function auditRows(action: string): Promise<{ id: string; after: unknown; actor_id: string | null }[]> {
  const rows = await admin.query<{ id: string; after: unknown; actor_id: string | null }>(
    "select id, after, actor_id from audit_log where tenant_id = $1::uuid and action = $2",
    [tenantId, action],
  );
  return rows.rows;
}

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'a-auth trace fixture', $3, 'Asia/Kolkata')",
    [tenantId, `a-auth-trace-${RUN_NUM}`, plan?.id ?? null],
  );
  await seedRoleTemplates(tenantId);

  const roleRow = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1::uuid and key = 'coach'",
    [tenantId],
  );

  issuerUserId = asUserId(uuidv7());
  issuerBaId = uuidv7();
  memberPhone = phone("71");
  await withPlatform(async () => {
    await db.insert(users).values({ id: issuerUserId, phone: phone("70") });
    await db.insert(users).values({ id: asUserId(uuidv7()), phone: memberPhone });
  });
  await withPlatform(async () => {
    await db.insert(baUser).values({
      id: issuerBaId,
      name: phone("70"),
      email: `${phone("70")}@phone.aqua.local`,
      phoneNumber: phone("70"),
      phoneNumberVerified: true,
    });
  });
  membershipId = uuidv7();
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
     values ($1, $2::uuid, (select id from users where phone = $3), $4, 'active')`,
    [membershipId, tenantId, memberPhone, roleRow.rows[0]!.id],
  );
});

beforeEach(async () => {
  await disarmOutboxFault();
  await disarmOutboxSkip();
  await disarmTraceStoreFault();
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from whatsapp_notification_outbox where tenant_id = $1::uuid", [tenantId]);
});

afterAll(async () => {
  await disarmOutboxFault();
  await disarmOutboxSkip();
  await disarmTraceStoreFault();
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from whatsapp_notification_outbox where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from tenant_memberships where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from roles where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
  await admin.query("delete from users where phone = any($1::text[])", [
    [phone("70"), memberPhone],
  ]);
  await admin.query("delete from ba_user where phone_number = $1", [phone("70")]);
  await admin.end();
});

describe("a rolled-back issuance leaves exactly one bounded trace and nothing else", () => {
  it("writes one failure trace, no issuance audit, no outbox row and no credential", async () => {
    await armOutboxFault();
    const result = await issueLoginLink(
      tenantId,
      membershipId,
      { tenantId, userId: issuerUserId, roleKey: "owner", permissions: new Set(["staff.invite"]) },
      { notify: true },
    );
    await disarmOutboxFault();

    // The bounded result stands.
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("notification_failed");

    // EXACTLY ONE trace: the attempt happened and was rolled back.
    const traces = await auditRows("staff.login_link_notification_failed");
    expect(traces).toHaveLength(1);
    // It names the actor and carries a FIXED code — nothing else.
    expect(traces[0]!.actor_id).toBe(issuerUserId);
    expect(traces[0]!.after).toEqual({
      code: "notification_not_queued",
      rolledBack: true,
    });

    // It does NOT claim an issuance, and nothing else was written.
    expect(await auditRows("staff.login_link_issued")).toHaveLength(0);
    expect(await countRows("select count(*)::int as n from whatsapp_notification_outbox where tenant_id = $1::uuid", [tenantId])).toBe(0);

    // No credential material in the trace: compare booleans so a failure
    // never prints the value.
    const payload = JSON.stringify(traces);
    expect(payload.includes(memberPhone)).toBe(false);
    expect(payload.includes("login/link/")).toBe(false);
    expect(payload.includes("notification fault")).toBe(false);
  });

  it("treats a FALSE enqueue result as a rollback: no issuance, no outbox, exactly one trace (R-2)", async () => {
    // The reviewed helper returns FALSE (it does not throw) when the
    // membership is missing or ineligible at the enqueue's read, or when
    // its outbox insert produced no row. The issuance REQUIRES true: a
    // false is the same failure as a throw, and must roll back.
    await armOutboxSkip();
    let result: Awaited<ReturnType<typeof issueLoginLink>>;
    try {
      result = await issueLoginLink(
        tenantId,
        membershipId,
        { tenantId, userId: issuerUserId, roleKey: "owner", permissions: new Set(["staff.invite"]) },
        { notify: true },
      );
    } finally {
      await disarmOutboxSkip();
    }

    // The bounded result stands, and it says the link was NOT created.
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("notification_failed");

    // The issuance did NOT commit: no credential, no issuance audit, no
    // outbox row — a false result rolled back exactly like a throw. The
    // error branch carries no token field by construction.
    expect(await auditRows("staff.login_link_issued")).toHaveLength(0);
    expect(
      await countRows("select count(*)::int as n from whatsapp_notification_outbox where tenant_id = $1::uuid", [tenantId]),
    ).toBe(0);

    // ALREADY in place from the throw case: EXACTLY ONE bounded trace, a
    // fixed code and nothing else.
    const traces = await auditRows("staff.login_link_notification_failed");
    expect(traces).toHaveLength(1);
    expect(traces[0]!.after).toEqual({ code: "notification_not_queued", rolledBack: true });
    const payload = JSON.stringify(traces);
    expect(payload.includes(memberPhone)).toBe(false);
    expect(payload.includes("login/link/")).toBe(false);
  });

  it("survives a trace-store failure with the bounded result, one fixed alert and no duplicate trace", async () => {
    // Both failures are forced for real: the outbox insert raises (the
    // enqueue cannot queue) AND the trace insert raises (the audit store is
    // down for that action too). The caller must still get the bounded
    // notification_failed result — a lost diagnostic is never a second
    // failure for the operator.
    const alerts = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let result: Awaited<ReturnType<typeof issueLoginLink>>;
    let calls: unknown[][] = [];
    try {
      await armOutboxFault();
      await armTraceStoreFault();
      result = await issueLoginLink(
        tenantId,
        membershipId,
        { tenantId, userId: issuerUserId, roleKey: "owner", permissions: new Set(["staff.invite"]) },
        { notify: true },
      );
      // mockRestore() also clears the recorded calls, so snapshot them while
      // the spy is still installed.
      calls = alerts.mock.calls.slice();
    } finally {
      await disarmOutboxFault();
      await disarmTraceStoreFault();
      alerts.mockRestore();
    }

    // The bounded result stands, unchanged by the store outage.
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("notification_failed");

    // The failed trace did not commit and left no duplicate or phantom row.
    expect(await auditRows("staff.login_link_notification_failed")).toHaveLength(0);

    // The issuance still rolled back: nothing survived and no credential
    // was returned. The error branch carries no token field by construction.
    expect(await auditRows("staff.login_link_issued")).toHaveLength(0);
    expect(
      await countRows("select count(*)::int as n from whatsapp_notification_outbox where tenant_id = $1::uuid", [tenantId]),
    ).toBe(0);

    // EXACTLY ONE fixed safe alert. One catch invocation means the trace was
    // ATTEMPTED once — a retry or a duplicate write would alert again — and
    // the fixed text and fixed values carry nothing from the failure.
    expect(calls).toHaveLength(1);
    expect(typeof calls[0]![0]).toBe("string");
    expect(calls[0]![1]).toEqual({
      code: "notification_trace_write_failed",
      rolledBack: true,
    });

    // It copies nothing: no cause, no trigger name, no id, no phone, no
    // token, no stack.
    const payload = JSON.stringify(calls);
    expect(payload.includes("a-auth trace store fault")).toBe(false);
    expect(payload.includes("a_auth_trace_store_fault")).toBe(false);
    expect(payload.includes(memberPhone)).toBe(false);
    expect(payload.includes(membershipId)).toBe(false);
    expect(payload.includes(tenantId)).toBe(false);
    expect(payload.includes(issuerUserId)).toBe(false);
    expect(payload.includes("login/link/")).toBe(false);
    expect(payload.includes("Error")).toBe(false);
  });

  it("still commits the issuance, its audit and the queued notification on the positive path", async () => {
    const result = await issueLoginLink(
      tenantId,
      membershipId,
      { tenantId, userId: issuerUserId, roleKey: "owner", permissions: new Set(["staff.invite"]) },
      { notify: true },
    );

    // The authorized positive case is preserved.
    expect(result.kind).toBe("ok");
    expect(await auditRows("staff.login_link_issued")).toHaveLength(1);
    // The notification really was queued: the OUTBOX ROW EXISTS (not
    // merely "no error").
    expect(
      await countRows("select count(*)::int as n from whatsapp_notification_outbox where tenant_id = $1::uuid", [tenantId]),
    ).toBe(1);
    // A successful attempt leaves NO failure trace.
    expect(await auditRows("staff.login_link_notification_failed")).toHaveLength(0);
  });
});
