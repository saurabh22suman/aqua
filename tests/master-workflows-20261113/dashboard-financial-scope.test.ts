import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { getOwnerDashboard } from "@/lib/services/dashboard";
import { addDays, todayInZone } from "@/lib/time/tz";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'reports.financial'),($1,$2,'invoices.read')",[f.tenantId,f.roleId]);
  const today = todayInZone("Asia/Kolkata");
  await f.admin.query(`insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source)
    select gen_random_uuid(),$1,$2,$3,'DASH-'||n,'2026-27',$4::date,case when n<=19 then $5::date else $6::date end,300000,0,300000,0,'issued','other' from generate_series(1,35) n`,
    [f.tenantId,f.locationA,f.memberId,addDays(today,-30),addDays(today,-1),addDays(today,1)]);
  await f.admin.query(`insert into payments(id,tenant_id,location_id,member_id,amount_paise,method,received_at)
    values(gen_random_uuid(),$1,$2,$3,300000,'cash',now())`,[f.tenantId,f.locationA,f.memberId]);
  await f.admin.query(`insert into invoices(id,tenant_id,location_id,payer_kind,guest_name,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source)
    values(gen_random_uuid(),$1,$2,'guest','Other site','DASH-OTHER','2026-27',$3,$4,900000,0,900000,0,'issued','other')`,[f.tenantId,f.locationB,addDays(today,-30),addDays(today,-1)]);
});
afterAll(async () => { if (f) await f.cleanup(); });

it("reads exact current and overdue totals and today's collection in the requested facility", async () => {
  const ctx = f.context();
  const result = await getOwnerDashboard({...ctx,permissions:new Set([...ctx.permissions,"reports.financial","invoices.read"])},{locationId:f.locationA});
  expect(result.money).toMatchObject({collectedTodayPaise:300000,collectedTodayCount:1,outstandingPaise:10500000,dueInvoiceCount:35,overduePaise:5700000,overdueInvoiceCount:19});
});

it("keeps real per-site membership data separate in the service", async () => {
  const result = await getOwnerDashboard(f.context());
  expect(result.facilityBreakdown.find(row => row.locationId === f.locationA)).toMatchObject({locationName:"A",activeMembers:1});
  expect(result.facilityBreakdown.find(row => row.locationId === f.locationB)).toMatchObject({locationName:"B",activeMembers:0});
});
