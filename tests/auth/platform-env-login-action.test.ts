// @vitest-environment node
// Real DB/session authority, with only the request transport mocked.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string,string>() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
    set: ({ name,value }: { name:string; value:string }) => cookieJar.set(name,value),
  }),
}));
class RedirectSignal extends Error {
  constructor(public path: string) { super(`REDIRECT:${path}`); }
}
vi.mock("next/navigation", () => ({ redirect: (path:string) => { throw new RedirectSignal(path); } }));
let id:string, email:string;
const password="a-twelve-character-secret", secret="JBSWY3DPEHPK3PXP";
const form = (fields: Record<string,string>) => { const data=new FormData(); for (const [k,v] of Object.entries(fields)) data.set(k,v); return data; };
beforeEach(async () => {
  id=randomUUID(); email=`env-action-${id}@example.test`; cookieJar.clear();
  vi.resetModules(); vi.stubEnv("OPS_EMAIL",email); vi.stubEnv("OPS_PASSWORD",password);
  await admin.query("insert into platform_users(id,email,name,password_hash,password_salt,totp_secret,totp_enrolled) values($1,$2,'Env action operator','preserved','preserved',$3,true)",[id,email,secret]);
});
afterEach(async () => {
  await admin.query("delete from platform_audit_log where actor_id=$1",[id]);
  await admin.query("delete from platform_sessions where user_id=$1",[id]);
  await admin.query("delete from platform_users where id=$1",[id]);
  await (await import("@/db/client")).pool.end(); cookieJar.clear(); vi.unstubAllEnvs();
});
afterAll(async () => admin.end());

describe("configured operator login actions", () => {
  it("requires the real authenticator before the cookie grants authority", async () => {
    const actions=await import("@/lib/actions/platform-auth");
    const { currentTotpCode }=await import("@/db/platform-auth");
    const { PLATFORM_COOKIE_NAME }=await import("@/lib/auth/platform-cookie");
    await expect(actions.loginPlatformAction(null,form({email,password}))).rejects.toEqual(new RedirectSignal("/ops/verify"));
    expect(cookieJar.get(PLATFORM_COOKIE_NAME)).toMatch(/^[a-f0-9]{64}$/);
    expect(await actions.platformAuthStatusAction()).toMatchObject({kind:"unauthenticated",userId:id});
    expect(await actions.requireOpsAdminAction()).toEqual({kind:"error",reason:"unauthenticated"});
    await expect(actions.verifyPlatformTotpAction(null,form({code:currentTotpCode(secret)}))).rejects.toEqual(new RedirectSignal("/ops"));
    expect(await actions.platformAuthStatusAction()).toMatchObject({kind:"authenticated",userId:id,role:"admin"});
    expect((await admin.query("select second_factor_passed from platform_sessions where user_id=$1",[id])).rows).toEqual([{second_factor_passed:true}]);
    expect((await admin.query("select id from platform_audit_log where actor_id=$1 and action='platform.login'",[id])).rows).toHaveLength(1);
  });
  it("refuses wrong passwords without a cookie or session", async () => {
    const { loginPlatformAction }=await import("@/lib/actions/platform-auth");
    expect(await loginPlatformAction(null,form({email,password:"wrong"}))).toEqual({kind:"error",message:"Wrong email or password."});
    expect(cookieJar.size).toBe(0);
    expect((await admin.query("select id from platform_sessions where user_id=$1",[id])).rows).toEqual([]);
  });
  it("answers unknown emails exactly like wrong passwords", async () => {
    const { loginPlatformAction }=await import("@/lib/actions/platform-auth");
    expect(await loginPlatformAction(null,form({email:`missing-${id}@example.test`,password:"wrong"})))
      .toEqual(await loginPlatformAction(null,form({email,password:"wrong"})));
  });
  it("rejects an unknown DB account when configured credentials are absent", async () => {
    vi.stubEnv("OPS_EMAIL",""); vi.stubEnv("OPS_PASSWORD",""); vi.resetModules();
    const { loginPlatformAction }=await import("@/lib/actions/platform-auth");
    expect(await loginPlatformAction(null,form({email:`missing-${id}@example.test`,password})))
      .toEqual({kind:"error",message:"Wrong email or password."});
    expect(cookieJar.size).toBe(0);
  });
  it("rejects malformed input before authentication", async () => {
    const { loginPlatformAction }=await import("@/lib/actions/platform-auth");
    expect(await loginPlatformAction(null,form({email:"invalid",password:""})))
      .toEqual({kind:"error",message:"Enter a valid email and password."});
    expect(cookieJar.size).toBe(0);
  });
});
describe("platform host separation", () => {
  it("404s the platform login on the tenant apex and serves the platform host", async () => {
    vi.stubEnv("OPS_HOST","aquaops.preprabbit.in"); vi.resetModules();
    const { middleware }=await import("@/middleware"); const { NextRequest }=await import("next/server");
    expect((await middleware(new NextRequest("http://aqua.preprabbit.in/ops/login",{headers:{host:"aqua.preprabbit.in"}}))).status).toBe(404);
    expect((await middleware(new NextRequest("http://aquaops.preprabbit.in/ops/login",{headers:{host:"aquaops.preprabbit.in"}}))).status).not.toBe(404);
  });
});
