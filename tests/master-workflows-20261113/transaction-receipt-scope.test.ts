import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { listHubTransactionsPage } from "@/lib/services/fees-hub";

let f: Awaited<ReturnType<typeof fixture>>;
const invoice = randomUUID(), hiddenInvoice = randomUUID(), payment = randomUUID(), reversal = randomUUID(), hidden = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query(`insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source)
    values($1,$2,$3,$4,'INV-PARTIAL','2026-27','2026-11-01','2026-11-15',200000,0,200000,100000,'partial','other')`,[invoice,f.tenantId,f.locationA,f.memberId]);
  await f.admin.query(`insert into invoices(id,tenant_id,location_id,payer_kind,guest_name,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source)
    values($1,$2,$3,'guest','Synthetic guest','INV-PRIVATE','2026-27','2026-11-01','2026-11-15',20000,0,20000,10000,'partial','other')`,[hiddenInvoice,f.tenantId,f.locationB]);
  await f.admin.query(`insert into payments(id,tenant_id,location_id,member_id,invoice_id,amount_paise,method,reference,received_at)
    values($1,$2,$3,$4,$5,100000,'upi','SYNTHETIC-REF','2026-11-13T06:00:00Z')`,[payment,f.tenantId,f.locationA,f.memberId,invoice]);
  await f.admin.query(`insert into payments(id,tenant_id,location_id,payer_kind,invoice_id,amount_paise,method,received_at)
    values($1,$2,$3,'guest',$4,10000,'cash','2026-11-13T06:00:00Z')`,[hidden,f.tenantId,f.locationB,hiddenInvoice]);
  await f.admin.query(`insert into payment_reversals(id,tenant_id,payment_id,amount_paise,reason,created_at) values($1,$2,$3,50000,'Correction','2026-11-13T07:00:00Z')`,[reversal,f.tenantId,payment]);
});
afterAll(async () => {
  if (f) { await f.admin.query("delete from payment_reversals where tenant_id=$1",[f.tenantId]); await f.cleanup(); }
});
it("keeps payment and reversal tied to the exact payment and hides other facilities", async () => {
  const result = await listHubTransactionsPage(f.context(f.managerId,"manager"),{from:"2026-11-13",to:"2026-11-14"});
  expect(result.rows.find(row => row.id === payment)).toMatchObject({paymentId:payment,kind:"payment",amountPaise:100000,invoiceNumber:"INV-PARTIAL"});
  expect(result.rows.find(row => row.id === reversal)).toMatchObject({paymentId:payment,kind:"reversal",amountPaise:-50000});
  expect(result.rows.some(row => row.id === hidden)).toBe(false);
  const ownerResult = await listHubTransactionsPage(f.context(),{from:"2026-11-13",to:"2026-11-14"});
  expect(ownerResult.rows.find(row => row.id === hidden)).toMatchObject({payerName:"Synthetic guest",memberId:null,invoiceNumber:"INV-PRIVATE"});
});
it("includes both IST boundary instants and excludes adjacent days", async () => {
  const ids = Array.from({length:4},() => randomUUID());
  const instants = ["2026-11-12T18:29:59Z","2026-11-12T18:30:00Z","2026-11-13T18:29:59Z","2026-11-13T18:30:00Z"];
  for (let i=0;i<ids.length;i++) await f.admin.query("insert into payments(id,tenant_id,location_id,member_id,invoice_id,amount_paise,method,received_at) values($1,$2,$3,$4,$5,1,'cash',$6)",[ids[i],f.tenantId,f.locationA,f.memberId,invoice,instants[i]]);
  const result = await listHubTransactionsPage(f.context(f.managerId,"manager"),{from:"2026-11-13",to:"2026-11-14"});
  const found = result.rows.map(row => row.id);
  expect(found).not.toContain(ids[0]);
  expect(found).toContain(ids[1]);
  expect(found).toContain(ids[2]);
  expect(found).not.toContain(ids[3]);
});
it("reports a capped ledger without claiming its visible rows are the whole range", async () => {
  await f.admin.query(`insert into payments(id,tenant_id,location_id,member_id,invoice_id,amount_paise,method,received_at)
    select gen_random_uuid(),$1,$2,$3,$4,1,'cash','2026-11-10T06:00:00Z'::timestamptz from generate_series(1,201)`,[f.tenantId,f.locationA,f.memberId,invoice]);
  const result = await listHubTransactionsPage(f.context(f.managerId,"manager"),{from:"2026-11-10",to:"2026-11-11"});
  expect(result.totalCount).toBe(201);
  expect(result.truncated).toBe(true);
  expect(result.rows).toHaveLength(result.limit);
  expect(result.rows.length).toBeLessThan(result.totalCount);
});
