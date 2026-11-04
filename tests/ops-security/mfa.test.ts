// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set: ({ name, value }: { name: string; value: string }) => jar.set(name, value),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
let id: string, email: string;
const password = "security-mfa-fixture-password", secret = "JBSWY3DPEHPK3PXP";
type Auth = typeof import("@/db/platform-auth");
let auth: Auth;
beforeEach(async () => {
  id = randomUUID(); email = `mfa-${id}@example.test`;
  vi.resetModules(); vi.stubEnv("OPS_EMAIL", email); vi.stubEnv("OPS_PASSWORD", password); jar.clear();
  await admin.query("insert into platform_users(id,email,name,password_hash,password_salt,totp_secret,totp_enrolled) values($1,$2,'MFA fixture','unchanged','unchanged',$3,true)", [id, email, secret]);
  auth = await import("@/db/platform-auth");
});
afterEach(async () => {
  await admin.query("delete from platform_audit_log where actor_id=$1", [id]);
  await admin.query("delete from platform_sessions where user_id=$1", [id]);
  await admin.query("delete from platform_users where id=$1", [id]);
  await (await import("@/db/client")).pool.end();
  vi.unstubAllEnvs(); jar.clear();
});
afterAll(async () => admin.end());
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k,v] of Object.entries(fields)) f.set(k,v); return f; };

describe("Ops password plus authenticator policy", () => {
  it("cannot authenticate with a password alone and preserves the stored credential", async () => {
    const result = await auth.platformLogin({ email, password });
    expect(result.kind).toBe("second_factor_required");
    expect((await auth.lookupPlatformSession(result.sessionToken)).kind).toBe("unauthenticated");
    const verified = await auth.platformVerifyTotp({ sessionToken: result.sessionToken, code: auth.currentTotpCode(secret) });
    expect(verified.kind).toBe("fully_authenticated");
    expect((await auth.lookupPlatformSession(verified.sessionToken)).kind).toBe("authenticated");
    expect((await admin.query("select password_hash from platform_users where id=$1", [id])).rows[0].password_hash).toBe("unchanged");
  });
  it("refuses an unenrolled or suspended operator even with the right env password", async () => {
    await admin.query("update platform_users set totp_enrolled=false where id=$1", [id]);
    await expect(auth.platformLogin({ email, password }).then(r => r.kind)).rejects.toMatchObject({ code: "no_totp" });
    await admin.query("update platform_users set totp_enrolled=true,status='suspended' where id=$1", [id]);
    await expect(auth.platformLogin({ email, password }).then(r => r.kind)).rejects.toMatchObject({ code: "user_suspended" });
    expect((await admin.query("select 1 from platform_sessions where user_id=$1", [id])).rows).toHaveLength(0);
  });
  it("rate limits authenticator guesses across fresh password challenges", async () => {
    for (let i = 0; i < 5; i++) {
      const pending = await auth.platformLogin({ email, password });
      const current = auth.currentTotpCode(secret);
      const wrong = current === "000000" ? "111111" : "000000";
      await expect(auth.platformVerifyTotp({ sessionToken: pending.sessionToken, code: wrong }).then(r => r.kind)).rejects.toMatchObject({ code: "invalid_totp" });
    }
    const pending = await auth.platformLogin({ email, password });
    await expect(auth.platformVerifyTotp({ sessionToken: pending.sessionToken, code: auth.currentTotpCode(secret) }).then(r => r.kind)).rejects.toMatchObject({ code: "rate_limited" });
  });
  it("connects both Server Actions to the real two-step flow", async () => {
    const { loginPlatformAction, verifyPlatformTotpAction, platformAuthStatusAction } = await import("@/lib/actions/platform-auth");
    await expect(loginPlatformAction(null, form({ email, password }))).rejects.toThrow("REDIRECT:/ops/verify");
    expect((await platformAuthStatusAction()).kind).toBe("unauthenticated");
    await expect(verifyPlatformTotpAction(null, form({ code: auth.currentTotpCode(secret) }))).rejects.toThrow("REDIRECT:/ops");
    expect((await platformAuthStatusAction()).kind).toBe("authenticated");
  });
  it("rejects the old passwordless Ops route even with a same-origin request", async () => {
    const { POST } = await import("@/app/(platform)/ops/api/whatsapp-auth/route");
    const response = await POST(new Request("http://ops.localhost/ops/api/whatsapp-auth", {
      method: "POST", headers: { host: "ops.localhost", origin: "http://ops.localhost", "content-type": "application/json" },
      body: JSON.stringify({ intent: "request", phone: "+919812345678" }),
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("refuses expired and completed password challenges", async () => {
    const pending = await auth.platformLogin({ email, password });
    await admin.query("update platform_sessions set expires_at=now()-interval '1 second' where user_id=$1", [id]);
    await expect(auth.platformVerifyTotp({ sessionToken: pending.sessionToken, code: auth.currentTotpCode(secret) }).then(r => r.kind))
      .rejects.toMatchObject({ code: "session_expired" });
    expect((await auth.lookupPlatformSession(pending.sessionToken)).kind).toBe("expired");
    const fresh = await auth.platformLogin({ email, password });
    await auth.platformVerifyTotp({ sessionToken: fresh.sessionToken, code: auth.currentTotpCode(secret) });
    await expect(auth.platformVerifyTotp({ sessionToken: fresh.sessionToken, code: auth.currentTotpCode(secret) }).then(r => r.kind))
      .rejects.toMatchObject({ code: "session_invalid" });
    expect((await admin.query("select id from platform_audit_log where actor_id=$1 and action='platform.login'", [id])).rows).toHaveLength(1);
  });
  it("allows only one concurrent verification of the same password challenge", async () => {
    const pending = await auth.platformLogin({ email, password });
    const outcomes = await Promise.allSettled([0,1].map(() => auth.platformVerifyTotp({ sessionToken: pending.sessionToken, code: auth.currentTotpCode(secret) }).then(r => r.kind)));
    expect(outcomes.filter(r => r.status === "fulfilled")).toEqual([{ status: "fulfilled", value: "fully_authenticated" }]);
    const rejected = outcomes.find(r => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.code).toBe("session_invalid");
    expect((await admin.query("select id from platform_audit_log where actor_id=$1 and action='platform.login'", [id])).rows).toHaveLength(1);
  });
  it("does not promote a session if the authenticator success audit cannot commit", async () => {
    const pending = await auth.platformLogin({ email, password });
    await admin.query(`create function sec_totp_audit_fail() returns trigger language plpgsql as $$ begin if new.action='platform.login' and new.actor_id='${id}'::uuid then raise exception 'synthetic totp audit failure'; end if; return new; end $$`);
    await admin.query("create trigger sec_totp_audit_fail before insert on platform_audit_log for each row execute function sec_totp_audit_fail()");
    try {
      await expect(auth.platformVerifyTotp({ sessionToken: pending.sessionToken, code: auth.currentTotpCode(secret) }).then(r => r.kind)).rejects.toThrow();
      expect((await auth.lookupPlatformSession(pending.sessionToken)).kind).toBe("unauthenticated");
      expect((await admin.query("select last_login_at from platform_users where id=$1", [id])).rows[0].last_login_at).toBeNull();
    } finally {
      await admin.query("drop trigger if exists sec_totp_audit_fail on platform_audit_log");
      await admin.query("drop function if exists sec_totp_audit_fail()");
    }
    expect((await auth.platformVerifyTotp({ sessionToken: pending.sessionToken, code: auth.currentTotpCode(secret) })).kind).toBe("fully_authenticated");
  });
  it("does not reveal a suspended DB operator to a caller with a wrong password", async () => {
    await (await import("@/db/client")).pool.end();
    vi.stubEnv("OPS_EMAIL", ""); vi.stubEnv("OPS_PASSWORD", ""); vi.resetModules();
    auth = await import("@/db/platform-auth");
    await admin.query("update platform_users set status='suspended' where id=$1", [id]);
    const { loginPlatformAction } = await import("@/lib/actions/platform-auth");
    expect(await loginPlatformAction(null, form({ email, password: "wrong" })))
      .toEqual(await loginPlatformAction(null, form({ email: `unknown-${id}@example.test`, password: "wrong" })));
  });

});
