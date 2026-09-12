// @vitest-environment node
//
// Slice 11 — env-only operator login.
//
// When OPS_EMAIL + OPS_PASSWORD are set, they are the only ops door:
// no platform_users password check, no TOTP, and the session is
// created fully authenticated. When they are unset, the existing
// DB+TOTP path is exactly as before. The pair is validated at boot
// (slice 1) — this file exercises the login branch.
//
// vi.resetModules + dynamic import are load-bearing: lib/env parses
// process.env at import time, so the stub must exist before the
// module graph loads.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { env } from "@/lib/env";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const OPS_EMAIL = "ops-test@example.com";
const OPS_PASSWORD = "a-twelve-character-secret";

async function cleanupOpsRows(): Promise<void> {
  const u = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [OPS_EMAIL],
  );
  const id = u.rows[0]?.id;
  if (!id) return;
  await admin.query("delete from platform_audit_log where actor_id = $1", [id]);
  await admin.query("delete from platform_sessions where user_id = $1", [id]);
  await admin.query("delete from platform_users where id = $1", [id]);
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("OPS_EMAIL", OPS_EMAIL);
  vi.stubEnv("OPS_PASSWORD", OPS_PASSWORD);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await cleanupOpsRows();
  await admin.end();
});

describe("platformLogin with OPS_EMAIL/OPS_PASSWORD set", () => {
  it("correct credentials return fully_authenticated and write a 2FA-passed session + audit row", async () => {
    await cleanupOpsRows();
    const { platformLogin } = await import("@/db/platform-auth");
    const result = await platformLogin({ email: OPS_EMAIL, password: OPS_PASSWORD });

    expect(result.kind).toBe("fully_authenticated");
    if (result.kind !== "fully_authenticated") return;
    expect(result.role).toBe("admin");
    expect(typeof result.sessionToken).toBe("string");

    const user = await admin.query<{ id: string }>(
      "select id from platform_users where email = $1",
      [OPS_EMAIL],
    );
    expect(user.rows).toHaveLength(1);
    expect(user.rows[0]!.id).toBe(result.userId);

    const sessions = await admin.query<{ second_factor_passed: boolean }>(
      "select second_factor_passed from platform_sessions where user_id = $1 order by created_at desc limit 1",
      [result.userId],
    );
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]!.second_factor_passed).toBe(true);

    const audit = await admin.query<{ action: string; detail: { method?: string } }>(
      "select action, detail from platform_audit_log where actor_id = $1 order by created_at desc limit 1",
      [result.userId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.action).toBe("platform.login");
    expect(audit.rows[0]!.detail.method).toBe("env");
  });

  it("a wrong password is invalid_credentials and creates no session", async () => {
    await cleanupOpsRows();
    const { platformLogin } = await import("@/db/platform-auth");
    await expect(
      platformLogin({ email: OPS_EMAIL, password: "wrong-password-entirely" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });

    const sessions = await admin.query("select 1 from platform_sessions");
    // No session for this run's operator (the table may hold other
    // rows in a shared dev DB, so check via the operator row if it
    // exists at all).
    const user = await admin.query<{ id: string }>(
      "select id from platform_users where email = $1",
      [OPS_EMAIL],
    );
    if (user.rows[0]) {
      const own = await admin.query(
        "select 1 from platform_sessions where user_id = $1",
        [user.rows[0].id],
      );
      expect(own.rows).toHaveLength(0);
    }
    expect(sessions).toBeDefined();
  });

  it("an email with different case still matches (credentials are case-normalised)", async () => {
    await cleanupOpsRows();
    const { platformLogin } = await import("@/db/platform-auth");
    const result = await platformLogin({
      email: OPS_EMAIL.toUpperCase(),
      password: OPS_PASSWORD,
    });
    expect(result.kind).toBe("fully_authenticated");
  });
});

describe("platformLogin with OPS_EMAIL/OPS_PASSWORD unset", () => {
  it("falls back to the DB path: an unknown user is invalid_credentials, not env-authenticated", async () => {
    vi.stubEnv("OPS_EMAIL", "");
    vi.stubEnv("OPS_PASSWORD", "");
    vi.resetModules();
    const { platformLogin } = await import("@/db/platform-auth");
    await expect(
      platformLogin({ email: OPS_EMAIL, password: OPS_PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});
