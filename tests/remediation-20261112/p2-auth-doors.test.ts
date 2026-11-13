import { randomUUID } from "node:crypto";
import { describe,expect,it } from "vitest";
import { ensureBaUserForPhone,setCredential,pinLogin,verifyCredentialPin } from "@/lib/services/credentials";
import { POST as login } from "@/app/api/login/pin/route";
import { POST as authPost,GET as authGet } from "@/app/api/auth/[...all]/route";

const origin=new URL(process.env.BETTER_AUTH_URL!).origin;
async function account() {
  const phone=`+91${BigInt("0x"+randomUUID().replaceAll("-","").slice(0,12))%9_000_000_000n+1_000_000_000n}`;
  const id=await ensureBaUserForPhone(phone);await setCredential(id,"123456");return {phone,id};
}
function headers(extra:Record<string,string>={}) {
  return {"content-type":"application/json",origin,host:new URL(origin).host,"x-real-ip":`2001:db8:${randomUUID().slice(0,4)}:${randomUUID().slice(0,4)}::1`,...extra};
}
function req(phone:string,extra:Record<string,string>={}) {
  return new Request(`${origin}/api/login/pin`,{method:"POST",headers:headers(extra),body:JSON.stringify({phone,pin:"123456"})});
}
describe("F09 generic auth surface cannot mutate PIN credentials",()=>{
  it("blocks a real authenticated change-password and preserves the working PIN",async()=>{
    const {phone,id}=await account(),signedIn=await pinLogin(phone,"123456");
    const cookie=signedIn.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
    const response=await authPost(new Request(`${origin}/api/auth/change-password`,{method:"POST",headers:headers({cookie}),body:JSON.stringify({currentPassword:"123456",newPassword:"abcdef",revokeOtherSessions:false})}));
    expect(response.status).toBe(404);
    expect(await verifyCredentialPin(id,"123456")).toBe(true);
    expect(await verifyCredentialPin(id,"abcdef")).toBe(false);
  });
  it.each(["/set-password","/change-email","/update-user","/phone-number/verify","/sign-in/email"])("does not forward the unapproved %s endpoint",async path=>{
    const response=await authPost(new Request(`${origin}/api/auth${path}`,{method:"POST",headers:headers(),body:"{}"}));
    expect(response.status).toBe(404);
  });
  it("retains the session read endpoint",async()=>{
    expect((await authGet(new Request(`${origin}/api/auth/get-session`))).status).toBe(200);
  });
  it("retains authenticated sign-out",async()=>{
    const {phone}=await account(),signedIn=await pinLogin(phone,"123456");
    const cookie=signedIn.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
    const response=await authPost(new Request(`${origin}/api/auth/sign-out`,{method:"POST",headers:headers({cookie}),body:"{}"}));
    expect(response.status).toBe(200);
    const session=await authGet(new Request(`${origin}/api/auth/get-session`,{headers:{cookie}}));
    expect(await session.json()).toBeNull();
  });
});
describe("F10 PIN login requires its configured origin and JSON",()=>{
  it("does not issue cookies to an unrelated origin",async()=>{
    const {phone}=await account();const response=await login(req(phone,{origin:"https://unrelated.invalid"}));
    expect(response.status).toBe(403);expect(response.headers.getSetCookie()).toEqual([]);
  });
  it("does not trust a forged matching Host and Origin pair",async()=>{
    const {phone}=await account();const response=await login(req(phone,{origin:"https://unrelated.invalid",host:"unrelated.invalid"}));
    expect(response.status).toBe(403);
  });
  it("rejects text/plain even with valid credentials",async()=>{
    const {phone}=await account();const response=await login(req(phone,{"content-type":"text/plain"}));
    expect(response.status).toBe(415);expect(response.headers.getSetCookie()).toEqual([]);
  });
  it("rejects requests with no Origin",async()=>{
    const {phone}=await account(),request=req(phone);request.headers.delete("origin");
    expect((await login(request)).status).toBe(403);
  });
  it("continues to issue a session for legitimate same-origin JSON",async()=>{
    const {phone}=await account();const response=await login(req(phone,{"content-type":"application/json; charset=utf-8"}));
    expect(response.status).toBe(200);expect(response.headers.getSetCookie().some(c=>c.includes("session_token="))).toBe(true);
    expect(response.headers.getSetCookie().some(c=>c.startsWith("aqua_active_club=") && c.includes("Expires="))).toBe(true);
  });
});
