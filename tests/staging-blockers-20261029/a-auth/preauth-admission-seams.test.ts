// @vitest-environment node
//
// Lane a-auth — POST-APPLY seam tests for the approved revision-8 pre-auth
// budget (test-specification cases 1.14, 1.16, 1.17 and 1.18).
//
// CLASSIFICATION: these cases exercise seams that only exist AFTER the
// approved revision-8 patch (`recordUnauthEvent`, `OPS_PREAUTH_*`,
// `runPlatformLoginAttempt`'s budget option, the admission helper). Before
// the patch they would fail at module resolution, not as product behaviour,
// so they are NOT part of the pre-apply intended RED. They are ordinary
// tests; the pre-apply RED is the three existing auth-path files.
//
// 1.14/1.17  a slow credential check must not hold the admission lock, and
//            the own-transaction writer must not deadlock against an open
//            attempt transaction (account/address -> admission ordering).
// 1.16       the admission lock is taken in ONE place, by the helper that
//            owns the count and the insert; every budget-owned family is
//            written through that helper.
// 1.18       after the global marker budget is spent, an unknown challenge
//            writes NO failure row; exactly one exhausted marker is written
//            and the caller is still refused.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { PlatformAuthError } from "@/db/platform-auth-crypto";
import { opsIdentityHash } from "@/db/platform-auth-audit";
import { runPlatformLoginAttempt } from "@/db/platform-auth-attempt";
import { OPS_PREAUTH_MARKER, recordUnauthEvent } from "@/db/platform-auth-preauth";
import { platformVerifyTotp } from "@/db/platform-auth";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await admin.query<{ n: number }>(sql, params);
  return rows.rows[0]!.n;
}

beforeEach(async () => {
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_sessions");
});

afterAll(async () => {
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_sessions");
  await admin.end();
});

describe("pre-auth admission lock — seam cases 1.14/1.16/1.17/1.18", () => {
  it("1.14/1.17 — a slow credential check never holds admission and the in-tx writer does not deadlock", async () => {
    const identity = `a-auth-seam-${randomUUID()}@example.test`;
    const address = "203.0.113.61";

    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // The attempt transaction takes its account/address locks first, then
    // runs this credential callback. The callback is still in flight when
    // the own-transaction writer below runs.
    const attempt = runPlatformLoginAttempt(
      "totp",
      identity,
      { ipAddress: address },
      async () => {
        entered();
        await gate;
        throw new PlatformAuthError("session_invalid", "session not found");
      },
      { budget: "unknown_challenge" },
    );
    await enteredPromise;

    // The own-transaction writer takes admission alone. If the attempt held
    // admission across the slow callback, this would not finish until the
    // gate is released.
    const outcome = await Promise.race([
      recordUnauthEvent({
        action: "platform.preauth.rejected",
        detail: { phase: "totp", outcome: "malformed" },
        ipAddress: address,
        phase: "totp",
        outcome: "malformed",
        correlationId: randomUUID(),
      }),
      sleep(3_000).then(() => "timeout" as const),
    ]);

    // Always release so a failure cannot hang the suite.
    release();
    await expect(attempt).rejects.toBeInstanceOf(PlatformAuthError);

    expect(outcome).toBe("written");

    // The attempt's own failure row is written by the in-tx helper AFTER
    // its account/address locks: admission was taken later, no cycle.
    const identityHash = opsIdentityHash("totp", identity);
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action = 'platform.login.failed.unknown' and detail->>'identityHash' = $1 and detail->>'unauthEvent' = 'true'",
        [identityHash],
      ),
    ).toBe(1);
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action = 'platform.preauth.rejected' and detail->>'unauthEvent' = 'true'",
      ),
    ).toBe(1);
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action = 'platform.login.throttled.unknown'",
      ),
    ).toBe(0);
  });

  it("1.16 — the admission lock has one call site and every budget-owned family uses the helper", () => {
    const root = process.cwd();
    const preauth = readFileSync(join(root, "db/platform-auth-preauth.ts"), "utf8");
    const attempt = readFileSync(join(root, "db/platform-auth-attempt.ts"), "utf8");
    const action = readFileSync(join(root, "lib/actions/platform-auth.ts"), "utf8");

    // The ONLY admission-lock statement is the helper's.
    const admissionLock =
      /pg_advisory_xact_lock\(hashtext\(\$\{OPS_PREAUTH_ADMISSION_LOCK\}\)\)/g;
    expect(preauth.match(admissionLock)).toHaveLength(1);
    expect(attempt).not.toMatch(
      /pg_advisory_xact_lock\(hashtext\(\$\{OPS_PREAUTH_ADMISSION_LOCK\}/,
    );
    expect(action).not.toContain("pg_advisory_xact_lock");

    // The attempt transaction's credential callback is outside the helper.
    expect(attempt).toMatch(/tx\.transaction\(authenticate\)/);
    expect(preauth).not.toContain("authenticate(");
    expect(preauth).not.toContain("scrypt(");

    // Every budget-owned family is written through the two exported
    // writers, never by a bare surface insert.
    expect(preauth).toMatch(/async function writeUnauthEventUnderAdmission\(/);
    expect(preauth).toMatch(/export async function recordUnauthEvent\(/);
    expect(preauth).toMatch(/export async function recordUnauthEventInTx\(/);
    expect(attempt).toMatch(/recordUnauthEventInTx\(tx, \{[^}]*action: throttledAction/);
    expect(attempt).toMatch(/recordUnauthEventInTx\(tx, \{[^}]*action: failureAction/);
    expect(action).toMatch(/recordUnauthEvent\(\{\s*action: OPS_PREAUTH_REJECTED/);
    expect(action).toMatch(/recordUnauthEvent\(\{\s*action: OPS_PREAUTH_LOGOUT_NOOP/);
  });

  it("1.18 — after the global budget is spent an unknown challenge writes only the exhausted marker", async () => {
    // Spend the global 200-row marker budget.
    await admin.query(
      `insert into platform_audit_log(action, detail, created_at)
       select 'platform.preauth.rejected', $1::jsonb, now()
       from generate_series(1, 200)`,
      [JSON.stringify({ [OPS_PREAUTH_MARKER]: true, phase: "password", outcome: "malformed" })],
    );

    const address = "203.0.113.62";
    let refused: unknown;
    try {
      await platformVerifyTotp(
        { sessionToken: `a-auth-seam-unknown-${randomUUID()}`, code: "123456" },
        { ipAddress: address },
      );
    } catch (error) {
      refused = error;
    }

    // The caller still gets the ordinary refusal.
    expect(refused).toBeInstanceOf(PlatformAuthError);
    expect((refused as PlatformAuthError).code).toBe("session_invalid");

    // No failure row after the marker...
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action = 'platform.login.failed.unknown'",
      ),
    ).toBe(0);
    // ...exactly one exhausted marker, marked and bounded...
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where action = 'platform.preauth.exhausted' and detail->>'unauthEvent' = 'true'",
      ),
    ).toBe(1);
    // ...and the global bound holds: the 200 seeded rows plus the marker.
    expect(
      await countRows(
        "select count(*)::int as n from platform_audit_log where detail->>'unauthEvent' = 'true'",
      ),
    ).toBe(201);
  });
});
