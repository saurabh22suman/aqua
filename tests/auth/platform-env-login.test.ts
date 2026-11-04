// @vitest-environment node
// Configured passwords must retain existing operator credentials and require TOTP.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";

let id: string, email: string;
const password = "a-twelve-character-secret", secret = "JBSWY3DPEHPK3PXP";
beforeEach(async () => {
  id = randomUUID(); email = `env-${id}@example.test`;
  vi.resetModules(); vi.stubEnv("OPS_EMAIL", email); vi.stubEnv("OPS_PASSWORD", password);
  await admin.query("insert into platform_users(id,email,name,password_hash,password_salt,totp_secret,totp_enrolled) values($1,$2,'Env operator','preserved','preserved',$3,true)", [id,email,secret]);
});
afterEach(async () => {
  await admin.query("delete from platform_audit_log where actor_id=$1", [id]);
  await admin.query("delete from platform_sessions where user_id=$1", [id]);
  await admin.query("delete from platform_users where id=$1", [id]);
  await (await import("@/db/client")).pool.end(); vi.unstubAllEnvs();
});
afterAll(async () => admin.end());

describe("configured Ops password", () => {
  it("creates only a pending challenge; TOTP completes the session and writes the login audit", async () => {
    const auth = await import("@/db/platform-auth");
    const pending = await auth.platformLogin({ email, password });
    expect(pending.kind).toBe("second_factor_required");
    expect(await auth.lookupPlatformSession(pending.sessionToken)).toMatchObject({ kind: "unauthenticated", userId: id });
    expect((await admin.query("select second_factor_passed from platform_sessions where user_id=$1", [id])).rows)
      .toEqual([{ second_factor_passed: false }]);
    const result = await auth.platformVerifyTotp({ sessionToken: pending.sessionToken, code: auth.currentTotpCode(secret) });
    expect(result.kind).toBe("fully_authenticated");
    expect(await auth.lookupPlatformSession(result.sessionToken)).toMatchObject({ kind: "authenticated", userId: id });
    expect((await admin.query("select password_hash,password_salt from platform_users where id=$1", [id])).rows)
      .toEqual([{ password_hash: "preserved", password_salt: "preserved" }]);
    const audits = (await admin.query("select detail from platform_audit_log where actor_id=$1 and action='platform.login'", [id])).rows;
    expect(audits).toHaveLength(1); expect(audits[0].detail.method).toBe("password_totp");
  });
  it("refuses a wrong password without creating a session", async () => {
    const { platformLogin } = await import("@/db/platform-auth");
    await expect(platformLogin({ email, password: "wrong-password-entirely" }).then(r => r.kind))
      .rejects.toMatchObject({ code: "invalid_credentials" });
    expect((await admin.query("select id from platform_sessions where user_id=$1", [id])).rows).toEqual([]);
  });
  it("normalises email case without bypassing the second factor", async () => {
    const { platformLogin } = await import("@/db/platform-auth");
    expect((await platformLogin({ email: email.toUpperCase(), password })).kind).toBe("second_factor_required");
  });
  it("falls back to DB credentials when configured credentials are absent, rejecting unknown users", async () => {
    vi.stubEnv("OPS_EMAIL", ""); vi.stubEnv("OPS_PASSWORD", ""); vi.resetModules();
    const { platformLogin } = await import("@/db/platform-auth");
    await expect(platformLogin({ email: `unknown-${id}@example.test`, password }).then(r => r.kind))
      .rejects.toMatchObject({ code: "invalid_credentials" });
  });
});
