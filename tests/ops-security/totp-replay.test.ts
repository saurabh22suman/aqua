// @vitest-environment node
// RFC6238 §5.2: a consumed authenticator code cannot complete a fresh challenge.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
let id: string, email: string;
const password = "replay-fixture-password", secret = "JBSWY3DPEHPK3PXP";
let auth: typeof import("@/db/platform-auth");
let clock: { mockReturnValue(value: number): unknown };
let now: number;
beforeEach(async () => {
  id=randomUUID(); email=`replay-${id}@example.test`;
  vi.resetModules(); vi.stubEnv("OPS_EMAIL",email); vi.stubEnv("OPS_PASSWORD",password);
  await admin.query("insert into platform_users(id,email,name,password_hash,password_salt,totp_secret,totp_enrolled) values($1,$2,'Replay fixture','unchanged','unchanged',$3,true)",[id,email,secret]);
  auth=await import("@/db/platform-auth");
  now=Math.floor(Date.now()/30_000)*30_000+15_000;
  clock=vi.spyOn(Date,"now").mockReturnValue(now);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await admin.query("delete from platform_audit_log where actor_id=$1",[id]);
  await admin.query("delete from platform_sessions where user_id=$1",[id]);
  await admin.query("delete from platform_users where id=$1",[id]);
  await (await import("@/db/client")).pool.end(); vi.unstubAllEnvs();
});
afterAll(async () => admin.end());
describe("Ops authenticator one-time use across password challenges", () => {
  it("refuses a code already used with a different valid password challenge", async () => {
    const first=await auth.platformLogin({email,password}), second=await auth.platformLogin({email,password});
    const code=auth.currentTotpCode(secret);
    expect((await auth.platformVerifyTotp({sessionToken:first.sessionToken,code})).kind).toBe("fully_authenticated");
    await expect(auth.platformVerifyTotp({sessionToken:second.sessionToken,code}).then(r=>r.kind)).rejects.toMatchObject({code:"invalid_totp"});
    expect((await auth.lookupPlatformSession(second.sessionToken)).kind).toBe("unauthenticated");
  });
  it("allows only one concurrent use across two distinct password challenges", async () => {
    const challenges=await Promise.all([0,1].map(()=>auth.platformLogin({email,password})));
    const code=auth.currentTotpCode(secret);
    const results=await Promise.allSettled(challenges.map(pending=>auth.platformVerifyTotp({sessionToken:pending.sessionToken,code}).then(r=>r.kind)));
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(r=>r.status==="rejected" && r.reason.code==="invalid_totp")).toHaveLength(1);
  });
  it("allows a fresh code in a later step without locking out the operator", async () => {
    const first=await auth.platformLogin({email,password});
    const used=auth.currentTotpCode(secret);
    await auth.platformVerifyTotp({sessionToken:first.sessionToken,code:used});
    let next=now+30_000;
    for (let tries=0; tries<10 && auth.currentTotpCode(secret,next)===used; tries++) next+=30_000;
    expect(auth.currentTotpCode(secret,next)).not.toBe(used);
    clock.mockReturnValue(next);
    const fresh=await auth.platformLogin({email,password});
    expect((await auth.platformVerifyTotp({sessionToken:fresh.sessionToken,code:auth.currentTotpCode(secret)})).kind).toBe("fully_authenticated");
  });
});
