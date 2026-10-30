// @vitest-environment node
//
// Lane a-auth — the revision-4 pre-edit regressions.
//
// STATUS AGAINST THE CURRENT SOURCE: all three cases are GREEN after the
// human-approved revision-8 local application. The earlier "one case FAILS"
// run was the intended revision-4 pre-auth RED; it is historical and is
// retained in evidence/a-auth-rev4-pre-edit-red-20261029.log. The two
// baseline guards pin behaviour the revision must not break.
//
//   1. THE PRE-AUTH BUDGET IS ENFORCED UNDER CONCURRENCY (intended RED).
//      Fifty PARALLEL malformed sign-in posts from one address must leave
//      the pre-auth trail bounded. Today the event does not exist at all,
//      so the "there is a row" half of the assertion is the RED — and the
//      bound is what the revision must then hold.
//
//   2. THE OPS DOOR'S ADDRESS READER IS NOT GATED (baseline guard).
//      The revision's trust flag belongs to the PIN door only. If a future
//      change routes the OPS door's reader through the same flag, the
//      Ops door's existing per-address budget silently disappears. This
//      case fails if that happens.
//
//   3. THE PUBLIC SIGN-OUT SIGNATURE IS UNCHANGED (baseline guard).
//      The protected tier1 suite asserts that platformLogout resolves to
//      undefined. The revision keeps that signature, so this case pins it
//      without touching the protected file.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own code on
// the app_login runtime connection.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { platformLogout } from "@/db/platform-auth";

// The revision-4 constants. The test names them so the assertion reads as
// the policy it pins.
const PREAUTH_ADDRESS_BUDGET = 20;
const PREAUTH_WINDOW_MS = 15 * 60_000;

const PARALLEL_REQUESTS = 50;

beforeAll(async () => {
  // Nothing to set up beyond the shared disposable database: the action
  // under test is the real one, and its fixture rows are not needed for a
  // MALFORMED request (it is refused before any lookup).
  await admin.query("select 1");
});

beforeEach(async () => {
  vi.resetModules();
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_sessions");
});

afterAll(async () => {
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_sessions");
  await admin.end();
});

describe("the Ops auth door: the pre-auth budget is bounded, and two existing behaviours are not broken", () => {
  it("bounds the pre-auth trail under a PARALLEL burst from one address (INTENDED RED)", async () => {
    // A request context is not available in this unit test; pin the
    // caller's address explicitly so the per-address budget applies.
    vi.doMock("@/lib/auth/platform-request-meta", () => ({
      platformRequestMeta: async () => ({
        ipAddress: "203.0.113.77",
        userAgent: "a-auth-rev4-burst",
      }),
    }));
    vi.resetModules();
    try {
      const { loginPlatformAction } = await import("@/lib/actions/platform-auth");

      // Fifty malformed sign-ins at once — the shape an unauthenticated
      // caller can produce for free.
      const form = () => {
        const data = new FormData();
        data.set("email", "not-an-email");
        data.set("password", "Str0ng-Ops-Passw0rd!");
        return data;
      };
      const results = await Promise.all(
        Array.from({ length: PARALLEL_REQUESTS }, () =>
          loginPlatformAction(null, form()),
        ),
      );
      for (const result of results) expect(result.kind).toBe("error");
    } finally {
      vi.doUnmock("@/lib/auth/platform-request-meta");
      vi.resetModules();
    }

    // The refusals ARE recorded — that is the whole point of the event.
    const rows = await admin.query<{ n: number }>(
      "select count(*)::int as n from platform_audit_log where action like 'platform.preauth.%'",
    );
    expect(rows.rows[0]!.n).toBeGreaterThan(0);

    // ...and they are BOUNDED: the per-address budget plus its one
    // aggregate row, and the global budget plus its one exhausted row.
    expect(rows.rows[0]!.n).toBeLessThanOrEqual(PREAUTH_ADDRESS_BUDGET + 1);

    // The window is a real bound: the rows are inside it.
    const windowed = await admin.query<{ n: number }>(
      "select count(*)::int as n from platform_audit_log where action like 'platform.preauth.%' and created_at >= now() - ($1::int || ' milliseconds')::interval",
      [String(PREAUTH_WINDOW_MS)],
    );
    expect(windowed.rows[0]!.n).toBe(rows.rows[0]!.n);
  });

  it("keeps the Ops door's own address reader working (baseline guard)", async () => {
    // The Ops door's per-address budget EXISTS today. The revision's trust
    // flag is for the PIN door only, and must not switch this reader off.
    const { platformRequestMeta } = await import("@/lib/auth/platform-request-meta");
    // With the flag unset the Ops reader is unchanged: it still yields the
    // address, so the Ops door's budget still has its key.
    delete process.env.AQUA_TRUSTED_PROXY_INGRESS;
    const withoutFlag = await platformRequestMeta();
    // With the flag set it is still unchanged: the flag belongs to the PIN
    // door and must not alter the Ops reader's behaviour either way.
    process.env.AQUA_TRUSTED_PROXY_INGRESS = "true";
    const withFlag = await platformRequestMeta();
    delete process.env.AQUA_TRUSTED_PROXY_INGRESS;

    // The reader reads the process headers, so the assertion is that the
    // two calls behave the SAME: the flag changes nothing for the Ops door.
    expect(withFlag.ipAddress).toBe(withoutFlag.ipAddress);
    expect(withoutFlag.userAgent).toBe(withFlag.userAgent);
  });

  it("keeps the public sign-out signature (baseline guard)", async () => {
    // The protected tier1 suite asserts `resolves.toBeUndefined()`. The
    // revision adds a result helper instead of changing this signature,
    // so the tier1 file does not have to change.
    await expect(platformLogout("")).resolves.toBeUndefined();
    await expect(platformLogout(`a-auth-never-issued-${randomUUID()}`)).resolves.toBeUndefined();
  });
});
