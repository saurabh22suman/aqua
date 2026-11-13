import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { fixture } from "./fixture";
import { resolveDefaultMembership,resolveSessionForLogin,resolveHomePath } from "@/db/platform";
let f:Awaited<ReturnType<typeof fixture>>,baId:string,membership:string;
beforeAll(async()=>{
  f=await fixture();baId=randomUUID();membership=randomUUID();const role=randomUUID();
  await f.admin.query("insert into ba_user(id,name,email) values($1,'Multi club',$2)",[baId,`${baId}@fixture.invalid`]);
  await f.admin.query("update users set better_auth_id=$2 where id=$1",[f.userId,baId]);
  await f.admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'coach','Coach','/coach',2)",[role,f.otherTenant]);
  await f.admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',false)",[membership,f.otherTenant,f.userId,role]);
});afterAll(async()=>{await f?.cleanup();});
describe("F04 multi-club resolution uses an explicit live membership",()=>{
  it("the shared home resolver also requests a choice",async()=>{expect(await resolveHomePath(baId)).toBe("/clubs");});
  it("requires selection instead of silently choosing the highest role",async()=>{
    expect(await resolveSessionForLogin(baId)).toEqual({kind:"ok",path:"/clubs"});
    expect(await resolveDefaultMembership(baId)).toMatchObject({requiresSelection:true});
  });
  it("resolves the selected club's role and location authority",async()=>{
    expect(await resolveDefaultMembership(baId,f.otherTenant)).toMatchObject({tenantId:f.otherTenant,roleKey:"coach",allLocations:false});
    expect(await resolveSessionForLogin(baId,f.otherTenant)).toEqual({kind:"ok",path:"/coach"});
  });
  it("does not fall back to a different club for a forged selection",async()=>{expect(await resolveDefaultMembership(baId,randomUUID())).toBeNull();expect(await resolveSessionForLogin(baId,randomUUID())).toEqual({kind:"ok",path:"/clubs"});});
  it("refuses a suspended club even while its membership stays active",async()=>{
    await f.admin.query("update tenants set status='suspended' where id=$1",[f.otherTenant]);
    try {expect(await resolveDefaultMembership(baId,f.otherTenant)).toBeNull();expect(await resolveSessionForLogin(baId,f.otherTenant)).toEqual({kind:"ok",path:"/clubs"});}
    finally {await f.admin.query("update tenants set status='active' where id=$1",[f.otherTenant]);}
  });
  it("revokes a previously selected membership immediately",async()=>{await f.admin.query("update tenant_memberships set status='revoked' where id=$1",[membership]);expect(await resolveDefaultMembership(baId,f.otherTenant)).toBeNull();});
  it("retains automatic landing when only one club is available",async()=>{expect(await resolveSessionForLogin(baId)).toEqual({kind:"ok",path:"/owner"});});
});
