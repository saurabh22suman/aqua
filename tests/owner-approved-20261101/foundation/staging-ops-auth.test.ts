// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";

const app = "https://sportsip-staging.preprabbit.in";
const host = "sportsip-staging-ops.preprabbit.in";
let id: string, email: string, password: string;
const secret = "JBSWY3DPEHPK3PXP"; // Existing synthetic authenticator fixture.
beforeEach(async () => {
  id = randomUUID(); email = `staging-test-${id}@example.test`; password = randomBytes(24).toString("hex");
  vi.resetModules();
  vi.stubEnv("OPS_EMAIL", email); vi.stubEnv("OPS_PASSWORD", password);
  vi.stubEnv("AQUA_DEPLOYMENT_STAGE", "preview");
  vi.stubEnv("OPS_STAGING_PASSWORD_ONLY", "true");
  vi.stubEnv("BETTER_AUTH_URL", app); vi.stubEnv("OPS_HOST", host);
  await admin.query("insert into platform_users(id,email,name,password_hash,password_salt,totp_secret,totp_enrolled) values($1,$2,'Test operator','preserved','preserved',$3,true)", [id, email, secret]);
});
afterEach(async () => {
  await admin.query("delete from platform_audit_log where actor_id=$1", [id]);
  await admin.query("delete from platform_sessions where user_id=$1", [id]);
  await admin.query("delete from platform_users where id=$1", [id]);
  await (await import("@/db/client")).pool.end(); vi.unstubAllEnvs();
});
afterAll(async () => admin.end());

describe("configured staging operator", () => {
  it("returns a real full session and records a non-secret password-only audit", async () => {
    const auth = await import("@/db/platform-auth");
    const result = await auth.platformLogin({ email, password });
    expect(result.kind).toBe("fully_authenticated");
    expect(await auth.lookupPlatformSession(result.sessionToken)).toMatchObject({ kind: "authenticated", userId: id, role: "admin" });
    const sessions = (await admin.query("select second_factor_passed,expires_at from platform_sessions where user_id=$1", [id])).rows;
    expect(sessions).toHaveLength(1); expect(sessions[0].second_factor_passed).toBe(true);
    expect(new Date(sessions[0].expires_at).getTime() - Date.now()).toBeGreaterThan((auth.PLATFORM_SESSION_TTL_SECONDS - 30) * 1000);
    const audits = (await admin.query("select detail from platform_audit_log where actor_id=$1 and action='platform.login'", [id])).rows;
    expect(audits).toHaveLength(1); expect(audits[0].detail.method).toBe("staging_password_only");
    expect(audits[0].detail.totpStep).toBeUndefined();
    for (const sensitive of [password, secret, result.sessionToken]) expect(JSON.stringify(audits).includes(sensitive)).toBe(false);
    const rows = (await admin.query("select totp_enrolled,totp_secret,password_hash,password_salt from platform_users where id=$1", [id])).rows;
    expect(rows[0]).toEqual({ totp_enrolled: true, totp_secret: secret, password_hash: "preserved", password_salt: "preserved" });
  });
  it("denies a wrong password", async () => {
    const auth = await import("@/db/platform-auth");
    await expect(auth.platformLogin({ email, password: password + "x" })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect((await admin.query("select id from platform_sessions where user_id=$1", [id])).rowCount).toBe(0);
  });
  it("denies a suspended operator", async () => {
    await admin.query("update platform_users set status='suspended' where id=$1", [id]);
    const auth = await import("@/db/platform-auth");
    await expect(auth.platformLogin({ email, password })).rejects.toMatchObject({ code: "user_suspended" });
    expect((await admin.query("select id from platform_sessions where user_id=$1", [id])).rowCount).toBe(0);
  });
  it("explicit false keeps ENV operator TOTP authentication", async () => {
    vi.stubEnv("OPS_STAGING_PASSWORD_ONLY", "false");
    const auth = await import("@/db/platform-auth");
    const challenge = await auth.platformLogin({ email, password });
    expect(challenge.kind).toBe("second_factor_required");
    expect(await auth.lookupPlatformSession(challenge.sessionToken)).toMatchObject({ kind: "unauthenticated", userId: id });
    const completed = await auth.platformVerifyTotp({ sessionToken: challenge.sessionToken, code: auth.currentTotpCode(secret) });
    expect(completed.kind).toBe("fully_authenticated");
    const audits = (await admin.query("select detail from platform_audit_log where actor_id=$1 and action='platform.login'", [id])).rows;
    expect(audits[0].detail.method).toBe("password_totp");
  });
  it.each([undefined, "false"])("ordinary DB operator retains password+TOTP with flag %s", async (flag) => {
    vi.stubEnv("OPS_EMAIL", ""); vi.stubEnv("OPS_PASSWORD", "");
    vi.stubEnv("OPS_STAGING_PASSWORD_ONLY", flag);
    const auth = await import("@/db/platform-auth");
    const actor = await auth.provisionPlatformUser({ email: `db-${email}`, name: "DB test operator", password });
    try {
      await auth.markTotpEnrolled(actor.id);
      const challenge = await auth.platformLogin({ email: `db-${email}`, password });
      expect(challenge.kind).toBe("second_factor_required");
      expect(await auth.lookupPlatformSession(challenge.sessionToken)).toMatchObject({ kind: "unauthenticated", userId: actor.id });
      const completed = await auth.platformVerifyTotp({ sessionToken: challenge.sessionToken, code: auth.currentTotpCode(actor.totpSecret) });
      expect(completed.kind).toBe("fully_authenticated");
      expect((await admin.query("select detail from platform_audit_log where actor_id=$1 and action='platform.login'", [actor.id])).rows[0].detail.method).toBe("password_totp");
    } finally {
      await admin.query("delete from platform_audit_log where actor_id=$1", [actor.id]);
      await admin.query("delete from platform_sessions where user_id=$1", [actor.id]);
      await admin.query("delete from platform_users where id=$1", [actor.id]);
    }
  });
  it.each(["TRUE", "1", "yes", "false ", ""])("rejects invalid flag value %#", async (value) => {
    const { parseEnv } = await import("@/lib/env");
    expect(() => parseEnv({ ...process.env, OPS_STAGING_PASSWORD_ONLY: value })).toThrow(/OPS_STAGING_PASSWORD_ONLY/);
  });
  it.each([
    { OPS_EMAIL: "", OPS_PASSWORD: "" },
    { OPS_EMAIL: "" },
    { OPS_PASSWORD: "" },
  ])("cannot enable without ENV credentials %#", async (override) => {
    const { parseEnv } = await import("@/lib/env");
    expect(() => parseEnv({ ...process.env, ...override })).toThrow();
  });
  it.each([
    { AQUA_DEPLOYMENT_STAGE: "production" }, { AQUA_DEPLOYMENT_STAGE: "development" },
    { BETTER_AUTH_URL: "https://aqua.preprabbit.in" }, { OPS_HOST: "aquaops.preprabbit.in" },
    { BETTER_AUTH_URL: `${app}/` }, { BETTER_AUTH_URL: `${app}:443` }, { BETTER_AUTH_URL: `${app}.evil.test` },
    { BETTER_AUTH_URL: "http://sportsip-staging.preprabbit.in" },
    { BETTER_AUTH_URL: "https://user@sportsip-staging.preprabbit.in" },
    { OPS_HOST: `${host}.evil.test` },
  ])("refuses unsafe enabled configuration %#", async (override) => {
    const { parseEnv } = await import("@/lib/env");
    expect(() => parseEnv({ ...process.env, ...override })).toThrow(/OPS_STAGING_PASSWORD_ONLY/);
  });
});
