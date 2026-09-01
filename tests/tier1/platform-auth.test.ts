import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import {
  provisionPlatformUser,
  platformLogin,
  platformVerifyTotp,
  lookupPlatformSession,
  platformLogout,
  verifyTotp,
  generateTotpSecret,
  markTotpEnrolled,
} from "@/db/platform-auth";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

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
  const ts = Date.now();
  const email = `${label}-${ts}@platform.test`;
  const password = `pw-${label}-${ts}`;
  const { id, totpSecret } = await provisionPlatformUser({
    email,
    name: `Test Operator ${label}-${ts}`,
    password,
    role: "admin",
  });
  await markTotpEnrolled(id);
  return { id, password, totpSecret, email };
}

function makeCode(secret: string, atMs = Date.now()): string {
  // Mirror the service's base32 decode so the test computes the same
  // HMAC key bytes the verifier will reconstruct from the stored secret.
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
  const keyBytes = Buffer.from(bytes);

  const counter = Math.floor(atMs / 1000 / 30);
  const counterHex = counter.toString(16).padStart(16, "0");
  const hmac = createHmac("sha1", keyBytes)
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

describe("verifyTotp", () => {
  it("accepts the current-step code for a known secret", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(verifyTotp(secret, makeCode(secret))).toBe(true);
  });

  it("rejects a code from a step well outside the ±1 window", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(verifyTotp(secret, makeCode(secret, Date.now() - 5 * 60 * 1000))).toBe(false);
  });

  it("rejects non-numeric and wrong-length codes without throwing", () => {
    expect(verifyTotp("JBSWY3DPEHPK3PXP", "abcdef")).toBe(false);
    expect(verifyTotp("JBSWY3DPEHPK3PXP", "12345")).toBe(false);
    expect(verifyTotp("JBSWY3DPEHPK3PXP", "1234567")).toBe(false);
  });
});

describe("generateTotpSecret", () => {
  it("produces 32 uppercase base32 chars", () => {
    for (let i = 0; i < 5; i++) {
      const s = generateTotpSecret();
      expect(s).toMatch(/^[A-Z2-7]{32}$/);
    }
  });

  it("produces different secrets on successive calls", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
  });
});

describe("provisionPlatformUser", () => {
  it("creates a user with a TOTP secret and no enrollment", async () => {
    const { id, totpSecret } = await provisionPlatformUser({
      email: `prov-${Date.now()}@platform.test`,
      name: "Prov Test",
      password: "ignored-for-this-test",
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(totpSecret).toMatch(/^[A-Z2-7]{32}$/);

    const result = await admin.query<{ totp_enrolled: boolean }>(
      "select totp_enrolled from platform_users where id = $1",
      [id],
    );
    expect(result.rows[0]?.totp_enrolled).toBe(false);
  });
});

describe("platformLogin", () => {
  it("rejects zod-invalid input before touching the database", async () => {
    await expect(
      platformLogin({ email: "not-an-email", password: "x" }),
    ).rejects.toThrow();
  });

  it("throws invalid_credentials for a wrong password", async () => {
    const { password, email } = await createEnrolledUser("wrong-pw");
    await expect(
      platformLogin({ email, password: password + "WRONG" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("throws invalid_credentials for a non-existent email and matches password-hashing cost", async () => {
    const start = Date.now();
    await expect(
      platformLogin({
        email: `nope-${Date.now()}@nowhere.test`,
        password: "anything-here",
      }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThan(20);
  });

  it("throws user_suspended for a suspended account", async () => {
    const { password, email } = await createEnrolledUser("suspended");
    await admin.query("update platform_users set status = 'suspended' where email = $1", [email]);
    await expect(
      platformLogin({ email, password }),
    ).rejects.toMatchObject({ code: "user_suspended" });
    await admin.query("update platform_users set status = 'active' where email = $1", [email]);
  });

  it("returns second_factor_required for a valid password", async () => {
    const { password, email } = await createEnrolledUser("ok-pw");
    const result = await platformLogin({ email, password });
    expect(result.kind).toBe("second_factor_required");
    if (result.kind !== "second_factor_required") return;
    expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("platformVerifyTotp", () => {
  async function loginAndGetToken() {
    const { password, email, totpSecret } = await createEnrolledUser("totp-ok");
    const login = await platformLogin({ email, password });
    if (login.kind !== "second_factor_required") throw new Error("expected half-auth");
    return { sessionToken: login.sessionToken, totpSecret, email };
  }

  it("promotes a half-authenticated session to fully_authenticated on correct TOTP", async () => {
    const { sessionToken, totpSecret } = await loginAndGetToken();
    const code = makeCode(totpSecret);
    const result = await platformVerifyTotp({ sessionToken, code });
    expect(result.kind).toBe("fully_authenticated");
    if (result.kind !== "fully_authenticated") return;
    expect(result.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.role).toBe("admin");
  });

  it("rejects an incorrect TOTP code", async () => {
    const { sessionToken } = await loginAndGetToken();
    await expect(
      platformVerifyTotp({ sessionToken, code: "000000" }),
    ).rejects.toMatchObject({ code: "invalid_totp" });
  });

  it("rejects an unknown session token", async () => {
    await expect(
      platformVerifyTotp({
        sessionToken: "f".repeat(64),
        code: "123456",
      }),
    ).rejects.toMatchObject({ code: "session_invalid" });
  });

  it("rejects a sub-32-byte token via zod before touching the database", async () => {
    await expect(
      platformVerifyTotp({ sessionToken: "tooshort", code: "123456" }),
    ).rejects.toThrow();
  });

  it("records a platform.login audit row on success", async () => {
    const { sessionToken, totpSecret, email } = await loginAndGetToken();
    await platformVerifyTotp({ sessionToken, code: makeCode(totpSecret) });
    const audit = await admin.query<{ action: string; actor_id: string }>(
      "select action, actor_id from platform_audit_log where actor_id = (select id from platform_users where email = $1) order by created_at desc limit 1",
      [email],
    );
    expect(audit.rows[0]?.action).toBe("platform.login");
  });
});

describe("lookupPlatformSession", () => {
  it("returns not_found for an empty token", async () => {
    const r = await lookupPlatformSession("");
    expect(r.kind).toBe("not_found");
  });

  it("returns not_found for a token with no matching session", async () => {
    const r = await lookupPlatformSession("a".repeat(64));
    expect(r.kind).toBe("not_found");
  });

  it("returns unauthenticated for a half-authenticated session", async () => {
    const { password, email } = await createEnrolledUser("lookup-half");
    const login = await platformLogin({ email, password });
    if (login.kind !== "second_factor_required") throw new Error("expected half-auth");
    const r = await lookupPlatformSession(login.sessionToken);
    expect(r.kind).toBe("unauthenticated");
    if (r.kind !== "unauthenticated") return;
    expect(r.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.role).toBe("admin");
  });

  it("returns authenticated after TOTP passes", async () => {
    const { password, email, totpSecret } = await createEnrolledUser("lookup-full");
    const login = await platformLogin({ email, password });
    if (login.kind !== "second_factor_required") throw new Error("expected half-auth");
    await platformVerifyTotp({ sessionToken: login.sessionToken, code: makeCode(totpSecret) });
    const r = await lookupPlatformSession(login.sessionToken);
    expect(r.kind).toBe("authenticated");
  });

  it("returns expired for a session past its TTL", async () => {
    const { password, email } = await createEnrolledUser("lookup-expired");
    const login = await platformLogin({ email, password });
    if (login.kind !== "second_factor_required") throw new Error("expected half-auth");
    await admin.query(
      "update platform_sessions set expires_at = now() - interval '1 minute' where user_id = (select id from platform_users where email = $1)",
      [email],
    );
    const r = await lookupPlatformSession(login.sessionToken);
    expect(r.kind).toBe("expired");
  });
});

describe("platformLogout", () => {
  it("deletes the session row, making the token not_found afterwards", async () => {
    const { password, email } = await createEnrolledUser("logout");
    const login = await platformLogin({ email, password });
    if (login.kind !== "second_factor_required") throw new Error("expected half-auth");
    await platformLogout(login.sessionToken);
    const r = await lookupPlatformSession(login.sessionToken);
    expect(r.kind).toBe("not_found");
  });

  it("is a no-op for an empty token", async () => {
    await expect(platformLogout("")).resolves.toBeUndefined();
  });
});
