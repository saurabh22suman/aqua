import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { listHubInvoices } from "@/lib/services/fees-hub";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("update persons set phone='+919876543210' where id=$1", [f.personId]);
  await f.admin.query(`insert into invoices (id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source)
    select gen_random_uuid(),$1,$2,$3,'INV-'||i,'2026-27','2026-11-01','2026-11-15',200000,0,200000,100000,'partial','other' from generate_series(1,105) i`,[f.tenantId,f.locationA,f.memberId]);
  await f.admin.query(`insert into invoices (id,tenant_id,location_id,payer_kind,guest_name,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source)
    values(gen_random_uuid(),$1,$2,'guest','Private guest','SECRET-ONE','2026-27','2026-11-01','2026-11-15',200000,0,200000,0,'issued','other')`,[f.tenantId,f.locationB]);
});
afterAll(async () => { await f?.cleanup(); });
it("searches the full scoped dataset by member, phone and exact invoice reference", async () => {
  const ctx = f.context();
  expect((await listHubInvoices(ctx,{status:"dues",locationId:f.locationA,search:"Synthetic member"}))).toHaveLength(105);
  expect((await listHubInvoices(ctx,{status:"dues",locationId:f.locationA,search:"9876543210"}))).toHaveLength(105);
  const matched = await listHubInvoices(ctx,{status:"dues",locationId:f.locationA,search:"INV-105"});
  expect(matched).toHaveLength(1);
  expect(matched[0]).toMatchObject({invoiceNumber:"INV-105",status:"partial",outstandingPaise:100000});
  expect(await listHubInvoices(ctx,{status:"dues",locationId:f.locationA,search:"%_"})).toEqual([]);
});
it("does not expose another facility or tenant to a restricted manager", async () => {
  const restricted = f.context(f.managerId,"manager");
  expect(await listHubInvoices(restricted,{status:"dues",search:"SECRET"})).toEqual([]);
  expect(await listHubInvoices({...restricted,tenantId:f.otherTenant},{status:"dues",search:"INV-105"})).toEqual([]);
});
