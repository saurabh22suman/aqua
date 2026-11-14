import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { fixture } from "../remediation-20261112/fixture";
import { saveClubBillingDefault } from "@/lib/services/facility-billing-settings";
import { updateTenantProfile } from "@/lib/services/tenant-profile";

let f:Awaited<ReturnType<typeof fixture>>;
const address={line1:"Synthetic Road",line2:null,city:"Mumbai",postalCode:"400001"};
const registered="27ABCDE1234F1Z5";
beforeEach(async()=>{f=await fixture();});
afterEach(async()=>{if(f){await f.admin.query("delete from orders where tenant_id=$1",[f.tenantId]);await f.cleanup();}});
async function change(writer:string,gstin:string|null){
  if(writer==="profile"){
    const result=await updateTenantProfile(f.context(),{gstin:gstin??""});
    return result.kind==="ok"?{ok:true}:{ok:false,code:result.code};
  }
  return saveClubBillingDefault(f.context(),{legalName:"Club Legal",legalAddress:address,stateCode:"27",gstin});
}
async function prepare(gstin:string|null,setting:"absent"|"disabled"|"override"="absent"){
  await f.admin.query("update tenants set gstin=$2,billing_legal_name='Club Legal',billing_legal_address=$3::jsonb,billing_state_code='27' where id=$1",[f.tenantId,gstin,JSON.stringify(address)]);
  const id=uuidv7();
  if(setting!=="absent")await f.admin.query("insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode,unregistered_legal_name,unregistered_legal_address) values($1,$2,'27',$3,'unregistered_override','Independent Legal',$4::jsonb)",[f.tenantId,f.locationA,setting==="override",JSON.stringify(address)]);
  await f.admin.query("insert into orders(id,tenant_id,location_id,member_id,status,channel,issuer_snapshot_version,issuer_legal_name,issuer_legal_address,issuer_state_code,issuer_registration_mode) values($1,$2,$3,$4,'placed','counter',$5,$6,$7::jsonb,$8,$9)",[id,f.tenantId,f.locationA,f.memberId,setting==="override"?1:0,setting==="override"?"Independent Legal":null,setting==="override"?JSON.stringify(address):null,setting==="override"?"27":null,setting==="override"?"unregistered":null]);
}

describe("Club GSTIN changes preserve open legacy order identity",()=>{
  for(const writer of ["profile","billing-default"]){
    for(const [label,initial,next,setting]of[
      ["registered to unregistered with no setting",registered,null,"absent"],
      ["unregistered to registered with disabled setting",null,registered,"disabled"],
    ]as const){
      it(`${writer} refuses ${label} while a legacy order is open`,async()=>{
        await prepare(initial,setting);
        expect(await change(writer,next)).toMatchObject({ok:false,code:"open_orders"});
        const row=await f.admin.query("select gstin from tenants where id=$1",[f.tenantId]);
        expect(row.rows[0].gstin).toBe(initial);
        expect((await f.admin.query("select status,issuer_snapshot_version from orders where tenant_id=$1",[f.tenantId])).rows[0]).toEqual({status:"placed",issuer_snapshot_version:0});
      });
    }
    it(`${writer} allows a no-op despite an open legacy order`,async()=>{
      await prepare(registered);
      expect((await change(writer,registered)).ok).toBe(true);
    });
    it(`${writer} permits a change when only independently overridden orders are open`,async()=>{
      await prepare(registered,"override");
      expect((await change(writer,null)).ok).toBe(true);
    });
  }
});
