// @vitest-environment node
//
// Lane a-auth — the acceptance cases the coordinator's review added to the
// Ops-auth-auditing proposal.
//
// STATUS: APPLIED LOCALLY AND EXECUTED. This file was specified during the
// proposal stage; it now runs against the applied revision-8 helper and the
// F1/F3 follow-up. The current result is 8 passed (A-H). The historical
// pre-apply RED of the separate completeness suite is retained in
// evidence/a-auth-rev8-intended-red-20261029.log; it is not this file's
// result.
//
// The proposal they specify: docs/audits/staging-blockers-20261029/a-auth/
// proposals/ops-auth-audit-completeness.md (+ the .patch.txt next to it).
//
// WHAT THESE CASES REQUIRE
//
//   A. An audit-store failure must not change the outcome of a refused
//      request: the request stays refused, and the loss is recorded as a
//      FIXED, SAFE, CORRELATED alert (a fixed code, the phase, the
//      outcome, the pseudonymous identity hash and a correlation id) —
//      never as a swallowed exception.
//   B. An audit-store failure must never copy the exception into the
//      alert or into an audit row: no name, no message, no stack, no
//      cause. Unexpected failures are classified with a FIXED code from a
//      closed set.
//   C. A failed success audit must leave no committed session, so the
//      caller's failure is truthful and a retry is legitimate — an
//      already committed outcome is never replaced by a misleading
//      retryable failure.
//   D. An unknown challenge must pass through the attempt boundary, so the
//      address limit COUNTS it and enforces the cap (the first revision
//      logged the refusal but returned before the limiter, so the cap did
//      not apply to it).
//   E. A pre-attempt subject-lookup exception must be recorded with a
//      fixed code and must not swallow the original error.
//   F. The sign-out NOOP (an unknown or already-revoked session) must not
//      produce a domain `platform.logout` row. The approved action-level
//      noop event (`platform.preauth.logout_noop`) is covered by the
//      separate preauth/NOOP suite; this case pins only the domain row.
//   G. A known-account wrong-password audit-store failure must keep the
//      credential refusal (no DB 500) and emit the fixed safe alert. RED
//      captured before the F1 fix; GREEN after it.
//   H. An unknown-challenge store failure alerts with the pseudonymous
//      identity hash and never the session token (F3 coverage).
//
// FAULT-INJECTION NOTES (the implementer confirms these at run time)
//
//   * The audit-store failure uses a BEFORE INSERT trigger on
//     platform_audit_log, scoped to ONE action, so the other audit rows
//     in the same test are unaffected. This mechanism is already proven
//     in this lane's other suites.
//   * The pre-attempt lookup failure renames `platform_sessions` for the
//     duration of the case; the next lookup fails with a real driver
//     error. The rename is reversed in the finally block.
//   * Every fault is disarmed in a finally block and again in afterAll.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own code on
// the app_login runtime connection.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { hashPassword, PlatformAuthError } from "@/db/platform-auth-crypto";
import { opsIdentityHash } from "@/db/platform-auth-audit";

const password = "Str0ng-Ops-Passw0rd!";
const operatorEmail = `a-auth-ops-store-${Date.now().toString(36)}@example.test`;
const operatorId = randomUUID();

let operatorIdInDb = "";

async function armAuditFault(action: string): Promise<void> {
  await admin.query("drop trigger if exists a_auth_store_fault on platform_audit_log");
  await admin.query("drop function if exists a_auth_store_fault()");
  await admin.query(`create function a_auth_store_fault() returns trigger language plpgsql as $$ begin
      if new.action = '${action}' then
        raise exception 'a-auth audit store fault';
      end if;
      return new; end $$`);
  await admin.query(
    "create trigger a_auth_store_fault before insert on platform_audit_log for each row execute function a_auth_store_fault()",
  );
}

async function disarmAuditFault(): Promise<void> {
  await admin.query("drop trigger if exists a_auth_store_fault on platform_audit_log");
  await admin.query("drop function if exists a_auth_store_fault()");
}

async function armLookupFault(): Promise<void> {
  // A rule cannot replace SELECT on a table. Rename the table instead:
  // the next platformSessions lookup fails with a real driver error, which
  // the pre-attempt catch must record and then rethrow unchanged.
  await disarmLookupFault();
  await admin.query(
    "alter table platform_sessions rename to platform_sessions_lookup_fault",
  );
}

async function disarmLookupFault(): Promise<void> {
  await admin.query(
    "alter table if exists platform_sessions_lookup_fault rename to platform_sessions",
  );
  await admin.query("drop function if exists a_auth_lookup_fault_fn()");
}

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await admin.query<{ n: number }>(sql, params);
  return rows.rows[0]!.n;
}

/** The alert lines emitted while the fault is armed. */
function capturedAlerts(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call) => call[1])
    .filter((payload): payload is Record<string, unknown> => !!payload && typeof payload === "object");
}

beforeAll(async () => {
  const salt = "a-auth-store-fixture-salt";
  await admin.query(
    `insert into platform_users(id,email,name,password_hash,password_salt,totp_secret,totp_enrolled,role,status)
     values($1,$2,'Ops store fixture',$3,$4,'JBSWY3DPEHPK3PXP',true,'admin','active')`,
    [operatorId, operatorEmail, hashPassword(password, salt), salt],
  );
  operatorIdInDb = operatorId;
});

beforeEach(async () => {
  await disarmAuditFault();
  await disarmLookupFault();
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_sessions");
});

afterAll(async () => {
  await disarmAuditFault();
  await disarmLookupFault();
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_sessions");
  await admin.query("delete from platform_users where id = $1::uuid", [operatorIdInDb]);
  await admin.end();
});

describe("the audit store can fail without changing an outcome or losing the evidence silently", () => {
  it("A — a refused request stays refused and the loss raises a fixed, correlated alert", async () => {
    let emitted: Record<string, unknown>[] = [];
    const alerts = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await armAuditFault("platform.preauth.rejected");
      const { loginPlatformAction } = await import("@/lib/actions/platform-auth");
      const form = new FormData();
      form.set("email", "not-an-email");
      form.set("password", password);

      const result = await loginPlatformAction(null, form);
      // The refusal is unchanged by the store failure: it is still a
      // refusal, never a success and never a different outcome.
      expect(result.kind).toBe("error");
    } finally {
      await disarmAuditFault();
      // Read the history BEFORE restoring: mockRestore() clears it.
      emitted = capturedAlerts(alerts as unknown as { mock: { calls: unknown[][] } });
      alerts.mockRestore();
    }

    expect(emitted.length).toBeGreaterThan(0);
    const alert = emitted[0]!;
    // A FIXED code and a FIXED key set.
    expect(alert.code).toBe("ops.auth.audit_write_failed");
    expect(alert.phase).toBe("password");
    expect(alert.outcome).toBe("malformed");
    expect(typeof alert.correlationId).toBe("string");
  });

  it("B — neither the alert nor an audit row copies the exception", async () => {
    let emitted: Record<string, unknown>[] = [];
    const alerts = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await armAuditFault("platform.preauth.rejected");
      const { loginPlatformAction } = await import("@/lib/actions/platform-auth");
      const form = new FormData();
      form.set("email", "not-an-email");
      form.set("password", password);
      await loginPlatformAction(null, form);
    } finally {
      await disarmAuditFault();
      // Read the history BEFORE restoring: mockRestore() clears it.
      emitted = capturedAlerts(alerts as unknown as { mock: { calls: unknown[][] } });
      alerts.mockRestore();
    }

    const payload = JSON.stringify(emitted);
    // The fault message, the trigger name and the exception class must not
    // appear: the alert carries a fixed code and fixed keys only.
    expect(payload).not.toContain("a-auth audit store fault");
    expect(payload).not.toContain("a_auth_store_fault");
    expect(payload).not.toContain("Error");
    for (const entry of emitted) {
      expect(Object.keys(entry).sort()).toEqual(
        ["code", "correlationId", "outcome", "phase"].filter((k) => k in entry).sort(),
      );
    }
  });

  it("C — a failed success audit leaves no committed session, so the failure is truthful", async () => {
    const { platformLogin } = await import("@/db/platform-auth");
    await armAuditFault("platform.login.password_passed");
    let failed = false;
    try {
      await platformLogin({ email: operatorEmail, password }, {});
    } catch {
      failed = true;
    } finally {
      await disarmAuditFault();
    }

    // Nothing was committed: no session, no success row. The caller's
    // failure is therefore truthful and a retry is legitimate — an
    // already committed outcome is never replaced by a retryable failure.
    expect(failed).toBe(true);
    expect(await countRows("select count(*)::int as n from platform_sessions")).toBe(0);
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action = 'platform.login.password_passed'",
      ),
    ).toBe(0);
  });

  it("G — a known-account wrong-password store failure keeps the credential refusal and alerts", async () => {
    let emitted: Record<string, unknown>[] = [];
    const alerts = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // The known-account failure row is the one direct insert left in the
      // attempt transaction. A store failure there must not replace the
      // credential refusal with a database error.
      await armAuditFault("platform.login.failed");
      const { loginPlatformAction } = await import("@/lib/actions/platform-auth");
      const form = new FormData();
      form.set("email", operatorEmail);
      form.set("password", "a-auth-wrong-password");

      const result = await loginPlatformAction(null, form);
      // The user still gets the ordinary credential refusal, not a 500.
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.message).toBe("Wrong email or password.");
      }
    } finally {
      await disarmAuditFault();
      emitted = capturedAlerts(alerts as unknown as { mock: { calls: unknown[][] } });
      alerts.mockRestore();
    }

    // Exactly one fixed, safe, correlated alert, carrying the pseudonymous
    // identity hash — never the raw email.
    expect(emitted).toHaveLength(1);
    const alert = emitted[0]!;
    expect(alert.code).toBe("ops.auth.audit_write_failed");
    expect(alert.phase).toBe("password");
    expect(alert.outcome).toBe("invalid_credentials");
    expect(alert.identityHash).toBe(opsIdentityHash("password", operatorEmail));
    expect(typeof alert.correlationId).toBe("string");
    const payload = JSON.stringify(emitted);
    expect(payload).not.toContain(operatorEmail);
    expect(payload).not.toContain("a-auth-wrong-password");

    // The failed row was not written; the refusal is still the outcome.
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action = 'platform.login.failed'",
      ),
    ).toBe(0);
  });

  it("H — an unknown-challenge store failure alerts with the pseudonymous hash, never the token", async () => {
    let emitted: Record<string, unknown>[] = [];
    const alerts = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = `a-auth-store-unknown-${randomUUID()}`;
    try {
      await armAuditFault("platform.login.failed.unknown");
      const { platformVerifyTotp } = await import("@/db/platform-auth");
      await expect(
        platformVerifyTotp(
          { sessionToken: token, code: "123456" },
          { ipAddress: "203.0.113.46" },
        ),
      ).rejects.toBeInstanceOf(PlatformAuthError);
    } finally {
      await disarmAuditFault();
      emitted = capturedAlerts(alerts as unknown as { mock: { calls: unknown[][] } });
      alerts.mockRestore();
    }

    expect(emitted).toHaveLength(1);
    const alert = emitted[0]!;
    expect(alert.code).toBe("ops.auth.audit_write_failed");
    expect(alert.phase).toBe("totp");
    expect(alert.outcome).toBe("session_invalid");
    expect(alert.identityHash).toBe(opsIdentityHash("totp", token));
    expect(JSON.stringify(emitted)).not.toContain(token);
  });

  it("D — an unknown challenge passes through the attempt boundary and is counted by the address limit", async () => {
    const { platformVerifyTotp } = await import("@/db/platform-auth");
    const address = "203.0.113.44";

    // Pre-spend the address's unknown-challenge budget (the same
    // fixture technique the proposal's cases 1.10/1.11 use for a spent
    // cap). These rows carry no pre-auth marker, so the per-address
    // pre-auth budget is untouched and the throttle row can be observed.
    for (let i = 0; i < 20; i += 1) {
      await admin.query(
        `insert into platform_audit_log(action, ip_address, detail, created_at)
         values ('platform.login.failed.unknown', $1::inet, $2::jsonb, now())`,
        [address, JSON.stringify({ phase: "totp", identityHash: `a-auth-fixture-${i}`, reason: "session_invalid" })],
      );
    }

    let refused = false;
    try {
      await platformVerifyTotp(
        { sessionToken: `a-auth-unknown-session-${randomUUID()}`, code: "123456" },
        { ipAddress: address },
      );
    } catch {
      refused = true;
    }
    // The caller is still refused by the attempt boundary...
    expect(refused).toBe(true);

    // ...and the throttle row exists with the budget marker: the refusal
    // went through the attempt boundary, not around it.
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action = 'platform.login.throttled.unknown' and ip_address = $1::inet and detail->>'unauthEvent' = 'true' and detail->>'budget' = 'unknown_challenge'",
        [address],
      ),
    ).toBe(1);
    // The refused attempt did not add a failure row of its own.
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action = 'platform.login.failed.unknown' and ip_address = $1::inet",
        [address],
      ),
    ).toBe(20);
  });

  it("E — a pre-attempt subject-lookup exception is recorded with a fixed code", async () => {
    const { platformVerifyTotp } = await import("@/db/platform-auth");
    await armLookupFault();
    let escaped = false;
    try {
      await platformVerifyTotp(
        { sessionToken: `a-auth-lookup-fault-${randomUUID()}`, code: "123456" },
        { ipAddress: "203.0.113.45" },
      );
    } catch {
      escaped = true;
    } finally {
      await disarmLookupFault();
    }
    // The original error still reaches the caller.
    expect(escaped).toBe(true);

    const rows = await admin.query<{ error_code: string | null; payload: string }>(
      "select detail->>'errorCode' as error_code, row_to_json(t)::text as payload from platform_audit_log t where action = 'platform.login.error'",
    );
    expect(rows.rows).toHaveLength(1);
    // A FIXED code from the closed set, never the exception's own name.
    expect(["db_error", "unknown_error"]).toContain(rows.rows[0]!.error_code);
    expect(rows.rows[0]!.payload).not.toContain("a-auth lookup fault");
  });

  it("F — a sign-out with an unknown session writes no domain logout row", async () => {
    const { platformLogout } = await import("@/db/platform-auth");
    await platformLogout(`a-auth-never-issued-${randomUUID()}`);

    // The domain event means ONE REAL SIGN-OUT. The approved action writes
    // the distinct platform.preauth.logout_noop event for this case; that
    // event is covered in ops-auth-preauth-and-noop.test.ts. This case pins
    // only the domain row: no successful logout is invented for an unknown
    // session.
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action = 'platform.logout'",
      ),
    ).toBe(0);
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action like 'platform.logout%' and action <> 'platform.logout'",
      ),
    ).toBe(0);
  });
});
