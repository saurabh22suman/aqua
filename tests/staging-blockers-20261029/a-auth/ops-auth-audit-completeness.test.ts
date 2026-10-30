// @vitest-environment node
//
// Lane a-auth — the auth portion of the new comprehensive Ops auditing.
//
// The human's requirement (29 Oct 2026): EVERY Ops operation is logged. For
// the auth door that means the password phase, the TOTP phase and the
// sign-out, AND their failure modes: malformed input, denial, a missing
// challenge and an unexpected error — each with minimised, safe metadata.
//
// WHAT IS ALREADY LOGGED (and must not change)
//
//   platform.login.password_passed   the password phase succeeded
//   platform.login                   the TOTP phase completed
//   platform.login.failed            a credential check failed
//   platform.login.throttled         the account/address limit refused
//   platform.logout                  the sign-out (human-approved, atomic)
//
// WHAT REVISION 8 ADDED (applied locally; the gap this suite covers)
//
//   1. a DENIAL is distinguishable from a wrong password: the failure row
//      now carries a fixed reason (invalid_credentials, user_suspended,
//      no_totp);
//   2. a TOTP attempt with an UNKNOWN session token writes a row on its own
//      `platform.login.failed.unknown` action through the attempt boundary;
//   3. a MISSING CHALLENGE (no platform session cookie) writes a bounded
//      `platform.preauth.rejected` event;
//   4. MALFORMED INPUT (an unparseable email or code) writes the same
//      bounded event;
//   5. an UNEXPECTED ERROR inside the attempt transaction is recorded
//      separately before the original error is rethrown.
//
// The existing limiters survive unchanged: the address/account limit
// counts `platform.login.failed` rows, and the one-time-use guard for an
// authenticator step reads `platform.login` rows. No counted action was
// renamed or removed.
//
// STATUS: APPLIED LOCALLY (human-approved revision 8), then corrected by
// the F1 follow-up for the known-account failure store error. The captured
// pre-apply RED (11 failed | 4 passed) is historical; the current focused
// run is GREEN. See HANDOFF.md §0.8-§0.9 and the successor packet.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own code on
// the app_login runtime connection.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { hashPassword } from "@/db/platform-auth-crypto";
import { env } from "@/lib/env";

const RUN = Date.now().toString(36);
const password = "Str0ng-Ops-Passw0rd!";

const operatorEmails = {
  wrongPassword: `a-auth-ops-wrong-${RUN}@example.test`,
  suspended: `a-auth-ops-suspended-${RUN}@example.test`,
  noTotp: `a-auth-ops-nototp-${RUN}@example.test`,
};

const operatorIds: string[] = [];

async function addOperator(email: string, opts: { status?: string; totpEnrolled?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  const salt = "a-auth-fixture-salt";
  await admin.query(
    `insert into platform_users(id,email,name,password_hash,password_salt,totp_secret,totp_enrolled,role,status)
     values($1,$2,'Ops audit fixture',$3,$4,$5,$6,'admin',$7)`,
    [
      id,
      email,
      hashPassword(password, salt),
      salt,
      "JBSWY3DPEHPK3PXP",
      opts.totpEnrolled ?? true,
      opts.status ?? "active",
    ],
  );
  operatorIds.push(id);
  return id;
}

/** The same pseudonymous key the attempt wrapper writes. */
function identityHash(phase: string, identity: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET ?? "ops-attempt-development-only")
    .update(`ops-login:${phase}:${identity.trim().toLowerCase()}`)
    .digest("hex");
}

async function countRows(sql: string, params: unknown[]): Promise<number> {
  const rows = await admin.query<{ n: number }>(sql, params);
  return rows.rows[0]!.n;
}

async function failureRowsFor(phase: string, identity: string): Promise<{ reason: string | null; detail: Record<string, unknown> }[]> {
  const rows = await admin.query<{ reason: string | null; detail: Record<string, unknown> }>(
    `select detail->>'reason' as reason, detail from platform_audit_log
     where action = 'platform.login.failed' and detail->>'identityHash' = $1 and detail->>'phase' = $2`,
    [identityHash(phase, identity), phase],
  );
  return rows.rows;
}

async function armSessionFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_ops_session_fault on platform_sessions");
  await admin.query("drop function if exists a_auth_ops_session_fault()");
  await admin.query(`create function a_auth_ops_session_fault() returns trigger language plpgsql as $$ begin
      raise exception 'a-auth ops session fault';
      end $$`);
  await admin.query(
    "create trigger a_auth_ops_session_fault before insert on platform_sessions for each row execute function a_auth_ops_session_fault()",
  );
}

async function disarmSessionFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_ops_session_fault on platform_sessions");
  await admin.query("drop function if exists a_auth_ops_session_fault()");
}

beforeAll(async () => {
  await addOperator(operatorEmails.wrongPassword, { totpEnrolled: true });
  await addOperator(operatorEmails.suspended, { status: "suspended", totpEnrolled: true });
  await addOperator(operatorEmails.noTotp, { totpEnrolled: false });
});

beforeEach(async () => {
  await disarmSessionFault();
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_sessions");
});

afterAll(async () => {
  await disarmSessionFault();
  for (const id of operatorIds) {
    await admin.query("delete from platform_audit_log where actor_id = $1::uuid", [id]);
  }
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_sessions");
  await admin.query("delete from platform_users where email like 'a-auth-ops-%@example.test'");
  await admin.end();
});

describe("the Ops auth operations are all logged (proposed behaviour)", () => {
  it("records the reason of a credential failure", async () => {
    const { platformLogin } = await import("@/db/platform-auth");
    await expect(
      platformLogin({ email: operatorEmails.wrongPassword, password: "wrong-password" }, {}),
    ).rejects.toThrow();

    const rows = await failureRowsFor("password", operatorEmails.wrongPassword);
    expect(rows).toHaveLength(1);
    // The reason makes a denial distinguishable from a wrong password.
    expect(rows[0]!.reason).toBe("invalid_credentials");
  });

  it("distinguishes a suspended account from a wrong password", async () => {
    const { platformLogin } = await import("@/db/platform-auth");
    await expect(
      platformLogin({ email: operatorEmails.suspended, password }, {}),
    ).rejects.toThrow();

    const rows = await failureRowsFor("password", operatorEmails.suspended);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("user_suspended");
  });

  it("distinguishes a missing second factor from a wrong password", async () => {
    const { platformLogin } = await import("@/db/platform-auth");
    await expect(
      platformLogin({ email: operatorEmails.noTotp, password }, {}),
    ).rejects.toThrow();

    const rows = await failureRowsFor("password", operatorEmails.noTotp);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("no_totp");
  });

  it("logs a TOTP attempt with an unknown session token", async () => {
    const { platformVerifyTotp } = await import("@/db/platform-auth");
    await expect(
      platformVerifyTotp({ sessionToken: `a-auth-unknown-session-${randomUUID()}`, code: "123456" }, {}),
    ).rejects.toThrow();

    const rows = await countRows(
      "select count(*)::int as n from platform_audit_log where action = 'platform.login.failed.unknown' and detail->>'reason' = 'session_invalid'",
      [],
    );
    expect(rows).toBe(1);
  });

  it("logs an unexpected error instead of losing the attempt with the rollback", async () => {
    const { platformLogin } = await import("@/db/platform-auth");
    await armSessionFault();
    let escaped = false;
    try {
      await platformLogin({ email: operatorEmails.wrongPassword, password }, {});
    } catch {
      escaped = true;
    } finally {
      await disarmSessionFault();
    }
    // The original failure still propagates to the caller.
    expect(escaped).toBe(true);

    const rows = await countRows(
      "select count(*)::int as n from platform_audit_log where action = 'platform.login.error'",
      [],
    );
    expect(rows).toBe(1);
  });

  it("logs malformed input to the password action", async () => {
    const { loginPlatformAction } = await import("@/lib/actions/platform-auth");
    const form = new FormData();
    form.set("email", "not-an-email");
    form.set("password", password);

    const result = await loginPlatformAction(null, form);
    expect(result.kind).toBe("error");

    const rows = await countRows(
      "select count(*)::int as n from platform_audit_log where action = 'platform.preauth.rejected' and detail->>'outcome' = 'malformed'",
      [],
    );
    expect(rows).toBe(1);
  });

  it("logs a missing challenge at the authenticator action", async () => {
    vi.doMock("@/lib/auth/platform-cookie", () => ({
      readPlatformSessionToken: async () => null,
      writePlatformSessionCookie: async () => {},
      clearPlatformSessionCookie: async () => {},
    }));
    vi.resetModules();
    try {
      const { verifyPlatformTotpAction } = await import("@/lib/actions/platform-auth");
      const form = new FormData();
      form.set("code", "123456");
      // The action redirects to the sign-in page when there is no
      // challenge; the redirect is not what this case asserts.
      await verifyPlatformTotpAction(null, form).catch(() => undefined);
    } finally {
      vi.doUnmock("@/lib/auth/platform-cookie");
      vi.resetModules();
    }

    const rows = await countRows(
      "select count(*)::int as n from platform_audit_log where action = 'platform.preauth.rejected' and detail->>'outcome' = 'missing_challenge'",
      [],
    );
    expect(rows).toBe(1);
  });

  it("never writes a password, a code, a raw email or a token into an audit row", async () => {
    const { platformLogin } = await import("@/db/platform-auth");
    await expect(
      platformLogin({ email: operatorEmails.wrongPassword, password: "wrong-password" }, {}),
    ).rejects.toThrow();

    const rows = await admin.query<{ payload: string }>(
      "select row_to_json(t)::text as payload from platform_audit_log t",
    );
    const payload = JSON.stringify(rows.rows);
    expect(payload).not.toContain(password);
    expect(payload).not.toContain("wrong-password");
    expect(payload).not.toContain(operatorEmails.wrongPassword);
    expect(payload).not.toContain("JBSWY3DPEHPK3PXP");
  });
});
