import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { sql } from "drizzle-orm";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { reconcileAppPrivileges } from "@/db/app-privileges";
import { env, requireMigrationUrl } from "@/lib/env";
let f:Awaited<ReturnType<typeof fixture>>;
const registration=uuidv7(), foreignRegistration=uuidv7(), invoice=uuidv7(), order=uuidv7();
const address={line1:"Synthetic Road",line2:null,city:"Mumbai",postalCode:"400001"};
beforeAll(async()=>{
  f=await fixture();
  for(const [id,tenant]of[[registration,f.tenantId],[foreignRegistration,f.otherTenant]])
    await f.admin.query("insert into billing_registrations(id,tenant_id,legal_name,legal_address,state_code,gstin) values($1,$2,'Immutable Issuer',$3::jsonb,'27','27ABCDE1234F1Z5')",[id,tenant,JSON.stringify(address)]);
  await f.admin.query("insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode,registration_id) values($1,$2,'27',true,'registered_override',$3)",[f.tenantId,f.locationA,registration]);
  await f.admin.query("insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,status,gstin,issuer_snapshot_version,issuer_legal_name,issuer_legal_address,issuer_state_code,issuer_registration_mode) values($1,$2,$3,$4,$5,'2026-27','2026-11-14','2026-11-14',100,0,100,'issued','27ABCDE1234F1Z5',1,'Immutable Issuer',$6::jsonb,'27','registered')",[invoice,f.tenantId,f.locationA,f.memberId,`S-${uuidv7().replaceAll('-','').slice(-12)}`,JSON.stringify(address)]);
  await f.admin.query("insert into orders(id,tenant_id,location_id,member_id,status,channel,issuer_snapshot_version,issuer_legal_name,issuer_legal_address,issuer_state_code,issuer_gstin,issuer_registration_mode) values($1,$2,$3,$4,'placed','counter',1,'Immutable Issuer',$5::jsonb,'27','27ABCDE1234F1Z5','registered')",[order,f.tenantId,f.locationA,f.memberId,JSON.stringify(address)]);
});
afterAll(async()=>{if(f){await f.admin.query("delete from orders where tenant_id=$1",[f.tenantId]);await f.cleanup();}});

// Supplementary independent database review; schema RED cycles recorded separately.
describe("Issuer persistence remains scoped and immutable under app_user",()=>{
  it("hides foreign registrations and rejects cross-tenant registration references",async()=>{
    const foreign=await withTenant(f.otherTenant,tx=>tx.execute(sql`select id from billing_registrations where id=${registration}::uuid`));
    expect(foreign.rows).toHaveLength(0);
    await expect(withTenant(f.tenantId,tx=>tx.execute(sql`update location_billing_settings set registration_id=${foreignRegistration}::uuid where tenant_id=${f.tenantId}::uuid and location_id=${f.locationA}::uuid`))).rejects.toThrow();
    const rows=await f.admin.query("select registration_id from location_billing_settings where tenant_id=$1 and location_id=$2",[f.tenantId,f.locationA]);
    expect(rows.rows[0].registration_id).toBe(registration);
  });
  it("retains immutable registration grants after repeated role bootstrap",async()=>{
    for(let n=0;n<2;n++){
      await bootstrapRoles(requireMigrationUrl("test"),env.APP_LOGIN_PASSWORD);
      await reconcileAppPrivileges(requireMigrationUrl("test"));
      const grants=await withTenant(f.tenantId,tx=>tx.execute(sql`select has_table_privilege(current_user,'public.billing_registrations','UPDATE') u,has_table_privilege(current_user,'public.billing_registrations','DELETE') d`));
      expect(grants.rows[0]).toEqual({u:false,d:false});
      await expect(withTenant(f.tenantId,tx=>tx.execute(sql`update billing_registrations set legal_name='Changed' where id=${registration}::uuid`))).rejects.toThrow();
      await expect(withTenant(f.tenantId,tx=>tx.execute(sql`delete from billing_registrations where id=${registration}::uuid`))).rejects.toThrow();
    }
  });
  it("refuses issuer rewrites and downgrade on an issued invoice",async()=>{
    await expect(withTenant(f.tenantId,tx=>tx.execute(sql`update invoices set issuer_legal_name='Changed' where id=${invoice}::uuid`))).rejects.toThrow();
    await expect(withTenant(f.tenantId,tx=>tx.execute(sql`update invoices set issuer_snapshot_version=0 where id=${invoice}::uuid`))).rejects.toThrow();
    await expect(withTenant(f.tenantId,tx=>tx.execute(sql`update invoices set gstin='27ABCDE1234F1Z6' where id=${invoice}::uuid`))).rejects.toThrow();
    const row=await f.admin.query("select issuer_legal_name,issuer_snapshot_version,gstin from invoices where id=$1",[invoice]);
    expect(row.rows[0]).toEqual({issuer_legal_name:"Immutable Issuer",issuer_snapshot_version:1,gstin:"27ABCDE1234F1Z5"});
  });
  it("keeps an order's issuer frozen while allowing operational status changes",async()=>{
    await expect(withTenant(f.tenantId,tx=>tx.execute(sql`update orders set issuer_legal_name='Changed' where id=${order}::uuid`))).rejects.toThrow();
    await expect(withTenant(f.tenantId,tx=>tx.execute(sql`update orders set issuer_snapshot_version=0 where id=${order}::uuid`))).rejects.toThrow();
    const row=await withTenant(f.tenantId,tx=>tx.execute(sql`update orders set status='served' where id=${order}::uuid returning issuer_legal_name,status`));
    expect(row.rows[0]).toEqual({issuer_legal_name:"Immutable Issuer",status:"served"});
  });
});
