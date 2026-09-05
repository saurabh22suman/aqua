import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import {
  provisionPlatformUser,
  markTotpEnrolled,
} from "@/db/platform-auth";
import {
  loginPlatformAction,
  verifyPlatformTotpAction,
  logoutPlatformAction,
  platformAuthStatusAction,
} from "@/lib/actions/platform-auth";
import {
  writePlatformSessionCookie,
  readPlatformSessionToken,
  clearPlatformSessionCookie,
} from "@/lib/auth/platform-cookie";

// Mock next/headers so server actions that read/write cookies can run
// in unit tests outside a Next.js request context. A plain Map replaces
// the cookie jar; production behaviour (HttpOnly, Secure, SameSite)
// is set by next/headers itself, so we test only the round-trip here.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = cookieJar.get(name);
      return v ? { name, value: v } : undefined;
    },
    set: (arg: { name: string; value: string }) => {
      cookieJar.set(arg.name, arg.value);
    },
  }),
}));

// H1 — the actions now call redirect() on success. Redirect throws
// NEXT_REDIRECT inside Next.js; in a unit test we want to capture
// the redirect target without honouring it. The mock turns redirect
// into a tagged error that the test can assert on.
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

const RUN = Date.now().toString(36);

beforeAll(async () => {
  await admin.query("delete from platform_sessions");
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_users");
});

afterAll(async () => {
  await admin.query("delete from platform_sessions");
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_users");
  await admin.end();
});

async function createEnrolledUser(label: string) {
  const ts = `${RUN}-${label}`;
  const email = `${label}-${ts}@platform.test`;
  const password = `pw-${label}-${ts}`;
  const { id, totpSecret } = await provisionPlatformUser({
    email,
    name: `Operator ${label}`,
    password,
    role: "admin",
  });
  await markTotpEnrolled(id);
  return { id, password, totpSecret, email };
}

function makeCode(secret: string, atMs = Date.now()): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = secret.replace(/=+$/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of cleaned) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`invalid base32 char: ${ch}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  const key = Buffer.from(bytes);
  const counter = Math.floor(atMs / 1000 / 30);
  const counterHex = counter.toString(16).padStart(16, "0");
  const hmac = createHmac("sha1", key)
    .update(Buffer.from(counterHex, "hex"))
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

describe("platform-cookie helpers", () => {
  it("writes and reads a session token", async () => {
    await writePlatformSessionCookie("a".repeat(64));
    const got = await readPlatformSessionToken();
    expect(got).toBe("a".repeat(64));
    await clearPlatformSessionCookie();
    const after = await readPlatformSessionToken();
    expect(after).toBeNull();
  });
});

describe("loginPlatformAction", () => {
  // H1 — actions take FormData and call redirect() on the success
  // path. The mock at the top of the file turns redirect() into a
  // thrown RedirectSignal, so the assertions below catch the path
  // instead of comparing against a removed result.kind.
  function fd(obj: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(obj)) f.set(k, v);
    return f;
  }

  it("returns error for zod-invalid input without touching the database", async () => {
    const result = await loginPlatformAction(null, fd({ email: "not-an-email", password: "" }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toMatch(/email and password/);
  });

  it("redirects to /platform/verify on a correct password and writes the half-auth cookie", async () => {
    const { password, email } = await createEnrolledUser("login-ok");
    let captured: string | null = null;
    try {
      await loginPlatformAction(null, fd({ email, password }));
    } catch (err) {
      if (err instanceof RedirectSignal) captured = err.path;
      else throw err;
    }
    expect(captured).toBe("/platform/verify");
    const cookie = await readPlatformSessionToken();
    expect(cookie).toMatch(/^[0-9a-f]{64}$/);
    await clearPlatformSessionCookie();
  });

  it("returns the generic error message on a wrong password, by design", async () => {
    const { password, email } = await createEnrolledUser("login-wrong");
    const result = await loginPlatformAction(null, fd({ email, password: password + "X" }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    // The message must not distinguish "wrong password" from "no such
    // user" — a known account + a wrong password is otherwise the
    // cheap way to enumerate emails.
    expect(result.message.toLowerCase()).toContain("email or password");
  });
});

describe("verifyPlatformTotpAction", () => {
  function fd(obj: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(obj)) f.set(k, v);
    return f;
  }

  it("rejects with sign-in-expired message when no cookie is set", async () => {
    await clearPlatformSessionCookie();
    const result = await verifyPlatformTotpAction(null, fd({ code: "123456" }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message.toLowerCase()).toContain("sign-in");
  });

  it("redirects to /platform on a correct code", async () => {
    const { password, email, totpSecret } = await createEnrolledUser("verify-ok");
    try {
      await loginPlatformAction(null, fd({ email, password }));
    } catch (err) {
      if (!(err instanceof RedirectSignal)) throw err;
    }
    let captured: string | null = null;
    try {
      await verifyPlatformTotpAction(null, fd({ code: makeCode(totpSecret) }));
    } catch (err) {
      if (err instanceof RedirectSignal) captured = err.path;
      else throw err;
    }
    expect(captured).toBe("/platform");
    await clearPlatformSessionCookie();
  });

  it("returns wrong-code error on an incorrect code and clears nothing", async () => {
    const { password, email } = await createEnrolledUser("verify-wrong");
    try {
      await loginPlatformAction(null, fd({ email, password }));
    } catch (err) {
      if (!(err instanceof RedirectSignal)) throw err;
    }
    const tokenBefore = await readPlatformSessionToken();
    const result = await verifyPlatformTotpAction(null, fd({ code: "000000" }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message.toLowerCase()).toContain("wrong");
    const tokenAfter = await readPlatformSessionToken();
    expect(tokenAfter).toBe(tokenBefore);
    await clearPlatformSessionCookie();
  });
});

describe("logoutPlatformAction", () => {
  function fd(obj: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(obj)) f.set(k, v);
    return f;
  }

  it("clears the cookie and removes the session row", async () => {
    const { password, email } = await createEnrolledUser("logout");
    try {
      await loginPlatformAction(null, fd({ email, password }));
    } catch (err) {
      if (!(err instanceof RedirectSignal)) throw err;
    }
    const tokenBefore = await readPlatformSessionToken();
    expect(tokenBefore).toMatch(/^[0-9a-f]{64}$/);
    const before = await admin.query<{ count: string }>(
      "select count(*)::text from platform_sessions",
    );
    await logoutPlatformAction();
    const tokenAfter = await readPlatformSessionToken();
    expect(tokenAfter).toBeNull();
    const after = await admin.query<{ count: string }>(
      "select count(*)::text from platform_sessions",
    );
    expect(Number(after.rows[0]!.count)).toBeLessThan(
      Number(before.rows[0]!.count),
    );
  });
});

describe("platformAuthStatusAction", () => {
  function fd(obj: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(obj)) f.set(k, v);
    return f;
  }

  it("reports not_found with no cookie", async () => {
    await clearPlatformSessionCookie();
    const status = await platformAuthStatusAction();
    expect(status.kind).toBe("not_found");
  });

  it("reports authenticated after a successful 2FA", async () => {
    const { password, email, totpSecret } = await createEnrolledUser("status-full");
    try {
      await loginPlatformAction(null, fd({ email, password }));
    } catch (err) {
      if (!(err instanceof RedirectSignal)) throw err;
    }
    try {
      await verifyPlatformTotpAction(null, fd({ code: makeCode(totpSecret) }));
    } catch (err) {
      if (!(err instanceof RedirectSignal)) throw err;
    }
    const status = await platformAuthStatusAction();
    expect(status.kind).toBe("authenticated");
    if (status.kind !== "authenticated") return;
    expect(status.role).toBe("admin");
    await clearPlatformSessionCookie();
  });
});
