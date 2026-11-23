import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { fixture } from "../remediation-20261112/fixture";
import { getOrCreateReceipt } from "@/lib/services/receipts";

let f: Awaited<ReturnType<typeof fixture>>;
const payment = uuidv7();

beforeAll(async () => {
  f = await fixture();
  const invoice = uuidv7();
  await f.admin.query("update tenants set name='भारत क्लब' where id=$1", [f.tenantId]);
  await f.admin.query("update persons set full_name='ಬೆಂಗಳೂರು ಆಟಗಾರ' where tenant_id=$1 and id=$2", [f.tenantId, f.personId]);
  await f.admin.query(`insert into invoices(id,tenant_id,location_id,member_id,payer_kind,invoice_number,
    financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source,gstin,issuer_snapshot_version)
    values($1,$2,$3,$4,'member',$5,'2026-27','2026-11-14','2026-11-14',100,0,100,100,'paid','other',null,0)`,
  [invoice, f.tenantId, f.locationA, f.memberId, `L-${uuidv7().replaceAll("-", "").slice(-12)}`]);
  await f.admin.query(`insert into payments(id,tenant_id,invoice_id,member_id,payer_kind,location_id,
    amount_paise,method,channel,received_at,status) values($1,$2,$3,$4,'member',$5,100,'cash','counter',
    '2026-11-14T00:30:00Z','captured')`, [payment, f.tenantId, invoice, f.memberId, f.locationA]);
});
afterAll(async () => { await f?.cleanup(); });

it("renders an uncached legacy invoice receipt with Unicode brand and payer, without inventing an issuer", async () => {
  const first = await getOrCreateReceipt(f.context(), payment);
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error(first.error);
  expect(first.pdf.toString("latin1")).toContain("/ToUnicode");
  const text = execFileSync("pdftotext", ["-", "-"], { input: first.pdf, encoding: "utf8" });
  expect(text).toContain("भारत क्लब");
  expect(text).toContain("ಬೆಂಗಳೂರು ಆಟಗಾರ");
  expect(text).not.toContain("Supplier details");
  await f.admin.query("update tenants set name='Later Club' where id=$1", [f.tenantId]);
  const cached = await getOrCreateReceipt(f.context(), payment);
  expect(cached.ok && cached.pdf.equals(first.pdf)).toBe(true);
});
