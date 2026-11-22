import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { fixture } from "../remediation-20261112/fixture";
import { createBillingRegistration, getClubBillingDefault, getSiteBillingSetting, saveClubBillingDefault, saveSiteBillingSetting } from "@/lib/services/facility-billing-settings";

let f: Awaited<ReturnType<typeof fixture>>;
const foreignSite=uuidv7();
const address={line1:"Synthetic Road",line2:null,city:"Mumbai",postalCode:"400001"};
const club={legalName:"Synthetic Legal",legalAddress:address,stateCode:"27",gstin:"27ABCDE1234F1Z5"};
beforeAll(async()=>{
  f=await fixture();
  await f.admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Foreign Site',true)",[foreignSite,f.otherTenant]);
  const saved=await saveClubBillingDefault(f.context(),club);
  if(!saved.ok) throw new Error(saved.message);
});
afterAll(async()=>{await f?.cleanup();});
const siteInput=()=>({locationId:f.locationA,stateCode:"27",choice:{mode:"inherit" as const},enable:true});

// Independent integration review coverage, added after implementation; no TDD claim.
describe("Facility settings live authority and tenant boundaries",()=>{
  it("denies a Manager even when the role has settings.manage",async()=>{
    const ctx=f.context(f.managerId,"manager");
    expect(await getClubBillingDefault(ctx)).toMatchObject({ok:false,code:"owner_required"});
    expect(await saveSiteBillingSetting(ctx,siteInput())).toMatchObject({ok:false,code:"owner_required"});
    expect(await createBillingRegistration(ctx,club)).toMatchObject({ok:false,code:"owner_required"});
  });
  it("denies a forged context for a foreign tenant and hides foreign sites",async()=>{
    expect(await getClubBillingDefault({...f.context(),tenantId:f.otherTenant})).toMatchObject({ok:false,code:"owner_required"});
    expect(await getSiteBillingSetting(f.context(),foreignSite)).toMatchObject({ok:false,code:"not_found"});
    expect(await saveSiteBillingSetting(f.context(),{...siteInput(),locationId:foreignSite})).toMatchObject({ok:false,code:"not_found"});
  });
  it("fails closed for soft-deleted physical sites",async()=>{
    await f.admin.query("update locations set deleted_at=now() where id=$1",[f.locationB]);
    try{
      expect(await getSiteBillingSetting(f.context(),f.locationB)).toMatchObject({ok:false,code:"not_found"});
      expect(await saveSiteBillingSetting(f.context(),{...siteInput(),locationId:f.locationB})).toMatchObject({ok:false,code:"not_found"});
    }finally{await f.admin.query("update locations set deleted_at=null where id=$1",[f.locationB]);}
  });
  it("rechecks a revoked Owner membership and refuses the write",async()=>{
    await f.admin.query("update tenant_memberships set status='revoked' where id=$1",[f.membershipId]);
    try{expect(await saveSiteBillingSetting(f.context(),siteInput())).toMatchObject({ok:false,code:"owner_required"});}
    finally{await f.admin.query("update tenant_memberships set status='active' where id=$1",[f.membershipId]);}
  });
  it("requires the live settings grant even when Owner membership is active",async()=>{
    await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=$2 and permission_key='settings.manage'",[f.tenantId,f.roleId]);
    try{expect(await saveClubBillingDefault(f.context(),{...club,legalName:"Denied Change"})).toMatchObject({ok:false,code:"owner_required"});}
    finally{await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'settings.manage')",[f.tenantId,f.roleId]);}
    expect(await getClubBillingDefault(f.context())).toMatchObject({ok:true,value:club});
  });
  it("rejects unknown scope/access keys and GSTIN-state mismatches without creating settings",async()=>{
    expect(await saveSiteBillingSetting(f.context(),{...siteInput(),tenantId:f.otherTenant})).toMatchObject({ok:false,code:"invalid"});
    expect(await createBillingRegistration(f.context(),{...club,stateCode:"29"})).toMatchObject({ok:false,code:"state_mismatch"});
    const result=await f.admin.query("select count(*)::int as count from location_billing_settings where tenant_id=$1",[f.tenantId]);
    expect(result.rows[0].count).toBe(0);
  });
});
