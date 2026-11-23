import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { listHubInvoices } from "@/lib/services/fees-hub";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query(`
    insert into invoices (id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source)
    values
      (gen_random_uuid(),$1,$2,$3,'OD-ISSUED','2026-27',(now() at time zone 'Asia/Kolkata')::date - 10,(now() at time zone 'Asia/Kolkata')::date - 5,100000,0,100000,0,'issued','other'),
      (gen_random_uuid(),$1,$2,$3,'OD-PARTIAL','2026-27',(now() at time zone 'Asia/Kolkata')::date - 10,(now() at time zone 'Asia/Kolkata')::date - 1,200000,0,200000,50000,'partial','other'),
      (gen_random_uuid(),$1,$2,$3,'FUTURE','2026-27',(now() at time zone 'Asia/Kolkata')::date,(now() at time zone 'Asia/Kolkata')::date + 5,100000,0,100000,0,'issued','other'),
      (gen_random_uuid(),$1,$2,$3,'SETTLED','2026-27',(now() at time zone 'Asia/Kolkata')::date - 10,(now() at time zone 'Asia/Kolkata')::date - 5,100000,0,100000,100000,'paid','other')
  `, [f.tenantId, f.locationA, f.memberId]);
});
afterAll(async () => { await f?.cleanup(); });

it("narrows Dues to past-due invoices with the normal balance guard and tenant clock", async () => {
  const ctx = f.context();
  const dues = await listHubInvoices(ctx, { status: "dues", locationId: f.locationA });
  expect(dues.map((row) => row.invoiceNumber)).toEqual(["OD-ISSUED", "OD-PARTIAL", "FUTURE"]);

  const overdue = await listHubInvoices(ctx, {
    status: "dues",
    locationId: f.locationA,
    overdueOnly: true,
  });
  expect(overdue.map((row) => row.invoiceNumber)).toEqual(["OD-ISSUED", "OD-PARTIAL"]);
  expect(overdue.every((row) => row.outstandingPaise > 0)).toBe(true);
});
