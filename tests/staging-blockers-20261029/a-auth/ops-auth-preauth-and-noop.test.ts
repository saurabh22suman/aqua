// @vitest-environment node
//
// Lane a-auth — the acceptance cases the coordinator's revision round added
// to the Ops-auth-auditing proposal (D's findings A1, A2 and the NOOP
// sign-out requirement).
//
// STATUS: APPLIED LOCALLY (human-approved revision 8). The captured run in
// the proposal stage was the pre-edit RED (the intended failing assertion);
// the current focused run is GREEN. The historical RED is retained in
// evidence/a-auth-rev8-intended-red-20261029.log.
//
// The proposal they specify: docs/audits/staging-blockers-20261029/a-auth/
// proposals/ops-auth-audit-completeness.md (revision 3) and the
// .patch.txt next to it.
//
// WHAT THESE CASES REQUIRE
//
//   1. A malformed request (no credential) IS recorded — but under the
//      BOUNDED pre-auth policy: the first rejections of an address are
//      recorded individually, later ones as a bounded aggregate, and the
//      number of rows stays bounded however many requests arrive. An
//      append-only table with no retention job must not have an unbounded
//      unauthenticated write path into it.
//   2. An unknown authenticator challenge is recorded on its OWN action and
//      on its OWN budget, and it does NOT consume the budget that protects
//      a known operator's sign-in: an unauthenticated caller must not be
//      able to lock an operator out.
//   3. A sign-out with a missing or unknown session records a truthful
//      NOOP operation event, and NEVER a domain `platform.logout` event
//      (a sign-out that did not happen must not be presented as one).
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own code on
// the app_login runtime connection.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { hashPassword } from "@/db/platform-auth-crypto";

const password = "Str0ng-Ops-Passw0rd!";
const operatorEmail = `a-auth-preauth-${Date.now().toString(36)}@example.test`;
const operatorId = randomUUID();

let operatorIdInDb = "";

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await admin.query<{ n: number }>(sql, params);
  return rows.rows[0]!.n;
}

async function preauthRows(): Promise<number> {
  return countRows(
    "select count(*)::int as n from platform_audit_log where action like 'platform.preauth.%'",
  );
}

beforeAll(async () => {
  const salt = "a-auth-preauth-fixture-salt";
  await admin.query(
    `insert into platform_users(id,email,name,password_hash,password_salt,totp_secret,totp_enrolled,role,status)
     values($1,$2,'Ops preauth fixture',$3,$4,'JBSWY3DPEHPK3PXP',true,'admin','active')`,
    [operatorId, operatorEmail, hashPassword(password, salt), salt],
  );
  operatorIdInDb = operatorId;
});

beforeEach(async () => {
  vi.doUnmock("@/lib/auth/platform-cookie");
  vi.resetModules();
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_sessions");
});

afterAll(async () => {
  vi.doUnmock("@/lib/auth/platform-cookie");
  vi.resetModules();
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_sessions");
  await admin.query("delete from platform_users where id = $1::uuid", [operatorIdInDb]);
  await admin.end();
});

describe("the Ops auth door: bounded pre-auth auditing, a separate unknown-challenge budget, a truthful sign-out NOOP", () => {
  it("records a malformed request and keeps the pre-auth rows bounded", async () => {
    // A request context is not available in this unit test; pin the
    // caller's address explicitly so the per-address budget applies.
    vi.doMock("@/lib/auth/platform-request-meta", () => ({
      platformRequestMeta: async () => ({
        ipAddress: "203.0.113.78",
        userAgent: "a-auth-preauth-test",
      }),
    }));
    vi.resetModules();
    try {
      const { loginPlatformAction } = await import("@/lib/actions/platform-auth");

      // A burst of malformed requests from ONE caller: no credential, no
      // session, nothing to authenticate.
      for (let i = 0; i < 40; i += 1) {
        const form = new FormData();
        form.set("email", "not-an-email");
        form.set("password", password);
        const result = await loginPlatformAction(null, form);
        expect(result.kind).toBe("error");
      }
    } finally {
      vi.doUnmock("@/lib/auth/platform-request-meta");
      vi.resetModules();
    }

    // The refusal IS recorded — that is the whole point of the event.
    expect(await preauthRows()).toBeGreaterThan(0);
    // ...and BOUNDED: the per-address budget plus its aggregate. A caller
    // that keeps hammering cannot grow the table without limit.
    expect(await preauthRows()).toBeLessThanOrEqual(21);
  });

  it("records an unknown challenge on its own action and leaves the operator's budget alone", async () => {
    const { platformVerifyTotp } = await import("@/db/platform-auth");

    await platformVerifyTotp(
      { sessionToken: `a-auth-unknown-${randomUUID()}`, code: "123456" },
      { ipAddress: "203.0.113.9" },
    ).catch(() => undefined);

    // The refusal is recorded — on its OWN action, so the budget that
    // protects a known operator (the `platform.login.failed` rows) is not
    // touched by an unauthenticated caller.
    const unknown = await countRows(
      "select count(*)::int as n from platform_audit_log where action = 'platform.login.failed.unknown'",
    );
    expect(unknown).toBeGreaterThan(0);
    const operatorBudget = await countRows(
      "select count(*)::int as n from platform_audit_log where action = 'platform.login.failed'",
    );
    expect(operatorBudget).toBe(0);
  });

  it("records a truthful NOOP for a sign-out with an unknown session and no domain sign-out", async () => {
    vi.doMock("@/lib/auth/platform-cookie", () => ({
      readPlatformSessionToken: async () => `a-auth-never-issued-${randomUUID()}`,
      writePlatformSessionCookie: async () => {},
      clearPlatformSessionCookie: async () => {},
    }));
    vi.resetModules();
    try {
      const { logoutPlatformAction } = await import("@/lib/actions/platform-auth");
      const result = await logoutPlatformAction();
      expect(result.kind).toBe("ok");
    } finally {
      vi.doUnmock("@/lib/auth/platform-cookie");
      vi.resetModules();
    }

    // The OPERATION is recorded, as a distinct noop event...
    const noop = await countRows(
      "select count(*)::int as n from platform_audit_log where action = 'platform.preauth.logout_noop'",
    );
    expect(noop).toBe(1);
    // ...and no DOMAIN sign-out is invented for a session that was not
    // there: the domain event means ONE REAL SIGN-OUT.
    const domain = await countRows(
      "select count(*)::int as n from platform_audit_log where action = 'platform.logout'",
    );
    expect(domain).toBe(0);
  });

  it("records no secret material in a pre-auth or NOOP row", async () => {
    vi.doMock("@/lib/auth/platform-cookie", () => ({
      readPlatformSessionToken: async () => `a-auth-never-issued-${randomUUID()}`,
      writePlatformSessionCookie: async () => {},
      clearPlatformSessionCookie: async () => {},
    }));
    vi.resetModules();
    try {
      const { loginPlatformAction } = await import("@/lib/actions/platform-auth");
      const form = new FormData();
      form.set("email", "not-an-email");
      form.set("password", password);
      await loginPlatformAction(null, form);
      const { logoutPlatformAction } = await import("@/lib/actions/platform-auth");
      await logoutPlatformAction();
    } finally {
      vi.doUnmock("@/lib/auth/platform-cookie");
      vi.resetModules();
    }

    const rows = await admin.query<{ payload: string }>(
      "select row_to_json(t)::text as payload from platform_audit_log t",
    );
    const payload = JSON.stringify(rows.rows);
    expect(payload).not.toContain(password);
    expect(payload).not.toContain("not-an-email");
    expect(payload).not.toContain("a-auth-never-issued");
    expect(payload).not.toContain("JBSWY3DPEHPK3PXP");
  });
});
