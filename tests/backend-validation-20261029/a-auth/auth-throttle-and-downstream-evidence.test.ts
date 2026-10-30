// @vitest-environment node
//
// Lane a-auth — behavioural evidence for the remaining findings.
//
//   F4 — the tenant PIN sign-in has no per-address throttle. better-auth's
//        own per-IP limiter lives in the handler's `onRequest` hook
//        (node_modules/better-auth/dist/api/index.mjs), and the app's
//        PIN service calls `auth.api.signInEmail` — a server-side API
//        call that never runs `onRequest`. The only throttle on the
//        tenant sign-in door is the per-ACCOUNT lockout.
//
//   F11 — a redemption consumes the single-use link (and flips the
//         membership) in the tenant transaction, and only then does the
//         platform-side credential/session work. A failure downstream
//         leaves the link spent.
//
//   F12 — the invitation notification is queued in the ISSUANCE'S OWN
//         transaction (the service's `notify` option). A failed enqueue
//         therefore rolls the issuance back with it: no credential, no
//         issuance audit and no token survive — and exactly ONE bounded
//         failure trace is written afterwards, so the attempt is never
//         silent.
//
// Each case injects a REAL database failure (a trigger), not a mock, and
// asserts the observable end state.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own services
// on the app_login runtime connection.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";
import { db } from "@/db/client";
import { withPlatform } from "@/db/scope";
import { users } from "@/db/schema/users";
import { baUser } from "@/db/schema/better-auth";
import { seedRoleTemplates } from "@/lib/services/roles";
import { pinLogin, setCredential } from "@/lib/services/credentials";
import { issueLoginLink } from "@/lib/services/invite-link-issue";
import { redeemLoginLink } from "@/lib/services/invite-link";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const phone = (suffix: string) => `+91983${RUN_NUM}${suffix}`;

let tenantId: TenantId = asTenantId("");
let coachMembershipId = "";
let coachUserId: UserId = asUserId("");
let coachBaId = "";
const sprayPhones: string[] = [];

async function armTrigger(table: string, name: string, fn: string): Promise<void> {
  await admin.query(`drop trigger if exists ${name} on ${table}`);
  await admin.query(`drop function if exists ${fn}()`);
  await admin.query(
    `create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'a-auth downstream fault'; end $$`,
  );
  await admin.query(
    `create trigger ${name} before insert on ${table} for each row execute function ${fn}()`,
  );
}

async function disarmTrigger(table: string, name: string, fn: string): Promise<void> {
  await admin.query(`drop trigger if exists ${name} on ${table}`);
  await admin.query(`drop function if exists ${fn}()`);
}

async function mkStaff(
  p: string,
): Promise<{ membershipId: string; userId: UserId; baId: string }> {
  const userId = asUserId(uuidv7());
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
  const roleRow = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1::uuid and key = 'coach'",
    [tenantId],
  );
  const membershipId = uuidv7();
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
     values ($1, $2::uuid, $3, $4, 'active')`,
    [membershipId, tenantId, userId, roleRow.rows[0]!.id],
  );
  return { membershipId, userId, baId };
}

async function mkInvitedStaff(
  p: string,
): Promise<{ membershipId: string; userId: UserId; baId: string }> {
  const made = await mkStaff(p);
  await admin.query(
    "update tenant_memberships set status = 'invited' where id = $1::uuid",
    [made.membershipId],
  );
  return made;
}

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'a-auth evidence', $3, 'Asia/Kolkata')",
    [tenantId, `a-auth-evidence-${RUN}`, plan?.id ?? null],
  );
  await seedRoleTemplates(tenantId);

  const coach = await mkStaff(phone("01"));
  coachMembershipId = coach.membershipId;
  coachUserId = coach.userId;
  coachBaId = coach.baId;
  await setCredential(coachBaId, "123456");

  // Four extra accounts with credentials, for the spray case.
  for (let i = 0; i < 4; i += 1) {
    const p = phone(`1${i}`);
    sprayPhones.push(p);
    const made = await mkStaff(p);
    await setCredential(made.baId, "123456");
  }
});

afterAll(async () => {
  await disarmTrigger("ba_session", "a_auth_ba_session_fault", "a_auth_ba_session_fault");
  await disarmTrigger(
    "whatsapp_notification_outbox",
    "a_auth_outbox_fault",
    "a_auth_outbox_fault",
  );
  if (tenantId) {
    await deleteAuditRowsForTenant(admin, tenantId);
    await admin.query("delete from invite_link_uses where tenant_id = $1", [tenantId]);
    await admin.query("delete from whatsapp_notification_outbox where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenant_memberships where tenant_id = $1", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  for (const p of [phone("01"), phone("02"), ...sprayPhones]) {
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
  }
  await admin.end();
});

describe("F4 — the tenant PIN door has no per-address throttle", () => {
  it("a wrong PIN against four different accounts all reach the credential check", async () => {
    for (const p of sprayPhones) {
      const res = await pinLogin(p, "999999");
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    // Every attempt was counted against its OWN account: no request was
    // refused before the credential check by an address/global throttle.
    const rows = await admin.query<{ phone: string; failed: number }>(
      "select phone, failed_pin_attempts as failed from users where phone = any($1::text[])",
      [sprayPhones],
    );
    expect(rows.rows).toHaveLength(4);
    for (const row of rows.rows) expect(row.failed).toBe(1);
  });

  it("better-auth's own per-IP limiter only guards the HTTP handler, which the app blocks", async () => {
    const { auth } = await import("@/lib/auth/server");
    const { POST } = await import("@/app/api/auth/[...all]/route");

    // The app refuses the better-auth sign-in door outright.
    const blocked = await POST(
      new Request("http://localhost:3199/api/auth/sign-in/email", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(blocked.status).toBe(404);

    // The limiter itself is real and strict (better-auth's default rule
    // for /sign-in* is 3 per 10s), but it lives in the handler's
    // onRequest hook — so it only applies to requests that go THROUGH the
    // handler. The PIN service calls auth.api.signInEmail instead, which
    // dispatches the endpoint directly and never runs onRequest.
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await auth.handler(
        new Request("http://localhost:3199/api/auth/sign-in/email", {
          method: "POST",
          body: "{}",
          headers: { "Content-Type": "application/json" },
        }),
      );
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

describe("F11 — a downstream failure after the link is consumed", () => {
  it("leaves the single-use link spent and the membership activated, with no session", async () => {
    // A fresh INVITED membership with no credential yet: an invite link
    // may be redeemed with a PIN, and the redemption flips the
    // membership to active in the tenant transaction.
    const invited = await mkInvitedStaff(phone("02"));
    await armTrigger("ba_session", "a_auth_ba_session_fault", "a_auth_ba_session_fault");
    let failed = false;
    try {
      const issued = await issueLoginLink(tenantId, invited.membershipId);
      if (issued.kind !== "ok") throw new Error("setup: link was not issued");
      const redeemed = await redeemLoginLink(issued.token, { pin: "654321" });
      failed = redeemed.kind === "error";
    } catch {
      failed = true;
    } finally {
      await disarmTrigger("ba_session", "a_auth_ba_session_fault", "a_auth_ba_session_fault");
    }
    expect(failed).toBe(true);

    // The link was consumed and the membership flipped BEFORE the
    // platform-side work, so both are already committed.
    const used = await admin.query<{ n: number }>(
      "select count(*)::int as n from invite_link_uses where tenant_id = $1",
      [tenantId],
    );
    expect(used.rows[0]!.n).toBeGreaterThan(0);
    const membership = await admin.query<{ status: string }>(
      "select status from tenant_memberships where id = $1::uuid",
      [invited.membershipId],
    );
    expect(membership.rows[0]!.status).toBe("active");
    const sessions = await admin.query<{ n: number }>(
      "select count(*)::int as n from ba_session where user_id = $1",
      [invited.baId],
    );
    expect(sessions.rows[0]!.n).toBe(0);
  });
});

describe("F12 — the invitation notification is queued in the issuance's own transaction", () => {
  it("a failed enqueue rolls the issuance back: no credential, no issuance audit, one bounded trace", async () => {
    // The action is exercised with an injected tenant context: the
    // authorization boundary (requireDefaultCtx + requirePermission) is
    // proven by the existing suites, and this file is about the
    // transaction boundary of the enqueue.
    const ctx = {
      tenantId,
      userId: coachUserId,
      roleKey: "owner",
      permissions: new Set(["staff.invite"]),
    };
    vi.doMock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ctx }));
    vi.resetModules();
    const { issueLoginLinkAction } = await import("@/lib/actions/invite-link");

    await armTrigger(
      "whatsapp_notification_outbox",
      "a_auth_outbox_fault",
      "a_auth_outbox_fault",
    );
    // The bounded result, or the marker that the action THREW. A throw is
    // a defect: the contract is a bounded `notification_failed` result.
    let outcome: { kind: string; code?: string } | null = null;
    try {
      const result = await issueLoginLinkAction(coachMembershipId);
      outcome =
        result.kind === "error"
          ? { kind: result.kind, code: result.code }
          : { kind: result.kind };
    } catch {
      outcome = { kind: "threw" };
    } finally {
      await disarmTrigger(
        "whatsapp_notification_outbox",
        "a_auth_outbox_fault",
        "a_auth_outbox_fault",
      );
      vi.doUnmock("@/lib/auth/context");
      vi.resetModules();
    }

    // The bounded result stands, and it says the link was NOT created.
    expect(outcome?.kind).toBe("error");
    expect(outcome?.code).toBe("notification_failed");

    // NOTHING of the issuance survived: the credential, its audit and the
    // token were rolled back with the failed enqueue. The error branch
    // carries no token field by construction.
    const issued = await admin.query<{ n: number }>(
      "select count(*)::int as n from audit_log where tenant_id = $1::uuid and action = 'staff.login_link_issued'",
      [tenantId],
    );
    expect(issued.rows[0]!.n).toBe(0);
    const outbox = await admin.query<{ n: number }>(
      "select count(*)::int as n from whatsapp_notification_outbox where tenant_id = $1",
      [tenantId],
    );
    expect(outbox.rows[0]!.n).toBe(0);

    // The attempt is NOT silent: EXACTLY ONE bounded trace, written after
    // the rollback in its own transaction, with a FIXED code and the actor.
    const traces = await admin.query<{ id: string; after: unknown; actor_id: string | null }>(
      "select id, after, actor_id from audit_log where tenant_id = $1::uuid and action = 'staff.login_link_notification_failed'",
      [tenantId],
    );
    expect(traces.rows).toHaveLength(1);
    expect(traces.rows[0]!.actor_id).toBe(coachUserId);
    expect(traces.rows[0]!.after).toEqual({
      code: "notification_not_queued",
      rolledBack: true,
    });

    // No credential material leaked into the trace: no phone, no token,
    // no link path and no cause. Compare booleans so a failure never
    // prints the value.
    const payload = JSON.stringify(traces.rows);
    expect(payload.includes(phone("01"))).toBe(false);
    expect(payload.includes("login/link/")).toBe(false);
    expect(payload.includes("a-auth downstream fault")).toBe(false);
  });
});
