import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { fixture } from "./fixture";
import { runPinAttempt } from "@/db/pin-attempt";
import { baSession } from "@/db/schema/better-auth";
import { ensureBaUserForPhone } from "@/lib/services/credentials";
let f:Awaited<ReturnType<typeof fixture>>,baId:string;
beforeAll(async()=>{f=await fixture();const {rows:[user]}=await f.admin.query("select phone from users where id=$1",[f.userId]);baId=await ensureBaUserForPhone(user.phone);});afterAll(async()=>{await f?.cleanup();});
describe("F02 failed verification cannot leave partial authentication writes",()=>{
 it.each(["returned","thrown"])("rolls back %s failure writes while committing its failure count",async mode=>{
  await f.admin.query("update users set failed_pin_attempts=0,pin_locked_until=null where id=$1",[f.userId]);const id=randomUUID();
  expect(await runPinAttempt({userId:f.userId},async tx=>{await tx.insert(baSession).values({id,userId:baId,token:randomUUID(),expiresAt:new Date(Date.now()+60000)});if(mode==="thrown")throw new Error("Verification refused");return {ok:false};})).toEqual({ok:false});
  expect((await f.admin.query("select id from ba_session where id=$1",[id])).rowCount).toBe(0);
  expect((await f.admin.query("select failed_pin_attempts from users where id=$1",[f.userId])).rows[0].failed_pin_attempts).toBe(1);
 });
 it("commits successful authentication writes and clears the failure count",async()=>{const id=randomUUID();expect(await runPinAttempt({userId:f.userId},async tx=>{await tx.insert(baSession).values({id,userId:baId,token:randomUUID(),expiresAt:new Date(Date.now()+60000)});return {ok:true,value:id};})).toEqual({ok:true,value:id});expect((await f.admin.query("select id from ba_session where id=$1",[id])).rowCount).toBe(1);expect((await f.admin.query("select failed_pin_attempts from users where id=$1",[f.userId])).rows[0].failed_pin_attempts).toBe(0);});
});
