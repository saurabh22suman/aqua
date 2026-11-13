import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { globalSearch } from "@/lib/services/global-search";

let f: Awaited<ReturnType<typeof fixture>>;
const invoice = randomUUID(), payment = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query(`insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source)
    values($1,$2,$3,$4,'INV-SEARCH','2026-27','2026-11-01','2026-11-15',200000,0,200000,100000,'partial','other')`,[invoice,f.tenantId,f.locationA,f.memberId]);
  await f.admin.query(`insert into payments(id,tenant_id,location_id,member_id,invoice_id,amount_paise,method,reference,received_at)
    values($1,$2,$3,$4,$5,100000,'upi','UTR-SEARCH','2026-11-13T06:00:00Z')`,[payment,f.tenantId,f.locationA,f.memberId,invoice]);
});
it("does not reveal payment references without the payment read grant or across tenants", async () => {
  const limited = {...f.context(),roleKey:"owner",permissions:new Set(["members.read","invoices.read"])};
  expect(await globalSearch(limited,"UTR-SEARCH")).toEqual([]);
  const other = {...limited,tenantId:f.otherTenant,permissions:new Set(["members.read","invoices.read","payments.read"])};
  expect(await globalSearch(other,"UTR-SEARCH")).toEqual([]);
});
afterAll(async () => { await f?.cleanup(); });
it("distinguishes an invoice total from the matching payment and keeps their exact identities", async () => {
  const ctx = {...f.context(),roleKey:"owner",permissions:new Set(["members.read","invoices.read","payments.read"])};
  const invoices = await globalSearch(ctx,"INV-SEARCH");
  expect(invoices.find(hit => hit.id === invoice)).toMatchObject({title:"Invoice INV-SEARCH",subtitle:expect.stringMatching(/invoice total/i),href:expect.stringContaining(`/owner/invoices/${invoice}`)});
  expect(invoices.find(hit => hit.id === invoice)?.href).toContain(`facility=${f.locationA}`);
  const payments = await globalSearch(ctx,"UTR-SEARCH");
  expect(payments.find(hit => hit.id === payment)).toMatchObject({title:expect.stringMatching(/payment/i),subtitle:expect.stringMatching(/received/i),href:`/api/receipts/${payment}`});
});
