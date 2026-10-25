// @vitest-environment node
//
// The env operator sign-in, END TO END through the Server Action.
//
// The env door itself has been covered at the database layer
// (tests/auth/platform-env-login.test.ts: platformLogin →
// loginWithEnvOperator → a 2FA-passed session + an audit row). What
// was NOT covered was the action in front of it: loginPlatformAction
// parsed the form and then returned "Use your registered phone and
// WhatsApp code to sign in." for EVERY input, so the email + password
// form the ops login page renders could never reach the door. The
// deployed operator saw that message with the right credentials.
//
// This file pins the action: the correct credentials authenticate and
// the session cookie authenticates afterwards; a wrong password is
// refused without a session; an unknown email is refused
// identically (no account enumeration); and with no env credentials
// configured the password door stays closed exactly as before.
//
// vi.resetModules + dynamic import are load-bearing: lib/env parses
// process.env at import time, so the stub must exist before the
// module graph loads.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { env } from "@/lib/env";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

// The cookie store and the redirect signal, mocked the way the
// platform-auth boundary test mocks them: the transport is faked,
// the session/audit writes are real.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { name, value } : undefined;
    },
    set: ({ name, value }: { name: string; value: string }) => {
      cookieJar.set(name, value);
    },
  }),
}));

class RedirectSignal extends Error {
  constructor(public path: string) {
    super(`REDIRECT:${path}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new RedirectSignal(path);
  },
}));

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const OPS_EMAIL = "ops-action-test@example.com";
const OPS_PASSWORD = "a-twelve-character-secret";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function operatorRow() {
  const { rows } = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [OPS_EMAIL],
  );
  return rows[0];
}

async function cleanupOpsRows(): Promise<void> {
  const row = await operatorRow();
  if (!row) return;
  await admin.query("delete from platform_audit_log where actor_id = $1", [row.id]);
  await admin.query("delete from platform_sessions where user_id = $1", [row.id]);
  await admin.query("delete from platform_users where id = $1", [row.id]);
}

beforeEach(async () => {
  cookieJar.clear();
  await cleanupOpsRows();
  vi.resetModules();
  vi.stubEnv("OPS_EMAIL", OPS_EMAIL);
  vi.stubEnv("OPS_PASSWORD", OPS_PASSWORD);
});

afterEach(() => {
  cookieJar.clear();
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterAll(async () => {
  await cleanupOpsRows();
  await admin.end();
});

describe("loginPlatformAction — the env operator door", () => {
  it("authenticates with the configured credentials and hands back a working session", async () => {
    const { loginPlatformAction, platformAuthStatusAction } = await import(
      "@/lib/actions/platform-auth"
    );
    const { PLATFORM_COOKIE_NAME } = await import("@/lib/auth/platform-cookie");

    await expect(
      loginPlatformAction(null, form({ email: OPS_EMAIL, password: OPS_PASSWORD })),
    ).rejects.toEqual(new RedirectSignal("/ops"));

    // The session cookie is set, and it authenticates: the platform
    // session resolves to the operator, not just to some token.
    const token = cookieJar.get(PLATFORM_COOKIE_NAME);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(await platformAuthStatusAction()).toMatchObject({
      kind: "authenticated",
      role: "admin",
    });

    // The session row is second-factor-passed and the sign-in is
    // audited — the same writes the database-layer door makes.
    const row = await operatorRow();
    expect(row).toBeDefined();
    const sessions = await admin.query<{ second_factor_passed: boolean }>(
      "select second_factor_passed from platform_sessions where user_id = $1",
      [row!.id],
    );
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]!.second_factor_passed).toBe(true);

    const audit = await admin.query<{ action: string; detail: { method?: string } }>(
      "select action, detail from platform_audit_log where actor_id = $1",
      [row!.id],
    );
    expect(audit.rows.some((r) => r.action === "platform.login")).toBe(true);
  });

  it("refuses a wrong password without creating a session", async () => {
    const { loginPlatformAction } = await import("@/lib/actions/platform-auth");
    const { PLATFORM_COOKIE_NAME } = await import("@/lib/auth/platform-cookie");

    expect(
      await loginPlatformAction(null, form({ email: OPS_EMAIL, password: "wrong-password" })),
    ).toEqual({ kind: "error", message: "Wrong email or password." });
    expect(cookieJar.get(PLATFORM_COOKIE_NAME)).toBeUndefined();

    const row = await operatorRow();
    if (row) {
      const sessions = await admin.query(
        "select 1 from platform_sessions where user_id = $1",
        [row.id],
      );
      expect(sessions.rows).toHaveLength(0);
    }
  });

  it("answers an unknown email exactly like a wrong password", async () => {
    // No account enumeration: the two cases must be
    // indistinguishable to the caller.
    const { loginPlatformAction } = await import("@/lib/actions/platform-auth");
    const wrongPassword = await loginPlatformAction(
      null,
      form({ email: OPS_EMAIL, password: "wrong-password" }),
    );
    const unknownEmail = await loginPlatformAction(
      null,
      form({ email: "nobody@example.com", password: "wrong-password" }),
    );
    expect(unknownEmail).toEqual(wrongPassword);
  });

  it("keeps the password door closed when no env credentials are configured", async () => {
    // Without the env door the platform signs in with a WhatsApp
    // code sent to a registered phone. The password door must say so
    // and must not create a session.
    vi.stubEnv("OPS_EMAIL", "");
    vi.stubEnv("OPS_PASSWORD", "");
    vi.resetModules();

    const { loginPlatformAction } = await import("@/lib/actions/platform-auth");
    const { PLATFORM_COOKIE_NAME } = await import("@/lib/auth/platform-cookie");

    expect(
      await loginPlatformAction(null, form({ email: OPS_EMAIL, password: OPS_PASSWORD })),
    ).toEqual({
      kind: "error",
      message: "Use your registered phone and WhatsApp code to sign in.",
    });
    expect(cookieJar.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
  });

  it("rejects malformed input before touching the door", async () => {
    const { loginPlatformAction } = await import("@/lib/actions/platform-auth");
    expect(await loginPlatformAction(null, form({ email: "not-an-email", password: "" }))).toEqual(
      { kind: "error", message: "Enter a valid email and password." },
    );
  });
});

describe("route separation — the platform door is served on the platform host only", () => {
  it("404s the platform login on the tenant apex and serves it on the platform host", async () => {
    vi.stubEnv("OPS_HOST", "aquaops.preprabbit.in");
    vi.resetModules();
    const { middleware } = await import("@/middleware");
    const { NextRequest } = await import("next/server");

    const onApex = await middleware(
      new NextRequest("http://aqua.preprabbit.in/ops/login", {
        headers: { host: "aqua.preprabbit.in" },
      }),
    );
    expect(onApex.status).toBe(404);

    const onPlatform = await middleware(
      new NextRequest("http://aquaops.preprabbit.in/ops/login", {
        headers: { host: "aquaops.preprabbit.in" },
      }),
    );
    expect(onPlatform.status).not.toBe(404);
  });
});
