import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "./fixture";
import { ensureBaUserForPhone, setCredential } from "@/lib/services/credentials";
import { POST } from "@/app/api/self/login/pin/route";

let f:Awaited<ReturnType<typeof fixture>>;
let phone:string;
const linkId=randomUUID();
let verifications=0,release!:()=>void;
const together=new Promise<void>(resolve=>{release=resolve;});
// Only link eligibility is stubbed; credential hashes, attempt budgets,
// account state and transactions remain real. All requests use a wrong PIN.
vi.mock("@/lib/auth/self-scope",()=>({readAccountLinkClubs:()=>Promise.resolve([{tenantId:f.tenantId,audience:"member",linkIds:[linkId]}])}));
vi.mock("@/lib/services/self-service-link-facts",()=>({readLinkFacts:()=>Promise.resolve([{linkId,memberId:f.memberId,linkIsLive:true,relationshipIsLive:true,childPersonSoftDeleted:false}])}));
vi.mock("@/lib/services/self-service-session",async original=>({...await original<typeof import("@/lib/services/self-service-session")>(),validateOmittedGuardianLinks:()=>Promise.resolve(true)}));
vi.mock("@/lib/services/credentials",async original=>{
  const actual=await original<typeof import("@/lib/services/credentials")>();
  return {...actual,verifyCredentialPin:async(...args:Parameters<typeof actual.verifyCredentialPin>)=>{
    if(++verifications===12) release();await together;return actual.verifyCredentialPin(...args);
  }};
});
beforeAll(async()=>{
  f=await fixture();phone=(await f.admin.query("select phone from users where id=$1",[f.userId])).rows[0].phone;
  const baId=await ensureBaUserForPhone(phone);await setCredential(baId,"123456");
});
afterAll(async()=>{release();await f?.cleanup();});
it("the alternate self-service door cannot bypass the same five-failure account lock",async()=>{
  const origin=new URL(process.env.BETTER_AUTH_URL!).origin;
  const responses=await Promise.all(Array.from({length:12},()=>POST(new Request(`${origin}/api/self/login/pin`,{method:"POST",headers:{"content-type":"application/json",origin,host:new URL(origin).host},body:JSON.stringify({phone,pin:"000000",clubId:f.tenantId,audience:"member"})}))));
  expect(responses.every(r=>r.status===401)).toBe(true);
  const {rows:[row]}=await f.admin.query("select failed_pin_attempts from users where id=$1",[f.userId]);
  expect(row.failed_pin_attempts).toBe(5);
  expect((await f.admin.query("select id from ba_session where user_id=(select better_auth_id from users where id=$1)",[f.userId])).rowCount).toBe(0);
},15000);
