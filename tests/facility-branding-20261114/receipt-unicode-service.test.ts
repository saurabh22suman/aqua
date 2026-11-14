import { afterAll, beforeAll, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { fixture } from "../remediation-20261112/fixture";
import { getOrCreateReceipt } from "@/lib/services/receipts";
import { execFileSync } from "node:child_process";

let f: Awaited<ReturnType<typeof fixture>>;
const payment = uuidv7();
const unsupportedPayment = uuidv7();
beforeAll(async () => {
  f = await fixture();
  const invoice = uuidv7();
  const address = { line1: "ಬೆಂಗಳೂರು ರಸ್ತೆ", line2: null, city: "ಬೆಂಗಳೂರು", postalCode: "560001" };
  await f.admin.query(`insert into invoices(id,tenant_id,location_id,member_id,payer_kind,invoice_number,
    financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source,gstin,
    issuer_snapshot_version,issuer_legal_name,issuer_legal_address,issuer_state_code,issuer_registration_mode)
    values($1,$2,$3,$4,'member',$5,'2026-27','2026-11-14','2026-11-14',100,0,100,100,'paid','other',
    null,1,'भारत खेल क्लब',$6::jsonb,'29','unregistered')`,
  [invoice, f.tenantId, f.locationA, f.memberId, `U-${uuidv7().replaceAll("-", "").slice(-12)}`, JSON.stringify(address)]);
  await f.admin.query(`insert into payments(id,tenant_id,invoice_id,member_id,payer_kind,location_id,
    amount_paise,method,channel,received_at,status) values($1,$2,$3,$4,'member',$5,100,'cash','counter',
    '2026-11-14T00:30:00Z','captured')`, [payment, f.tenantId, invoice, f.memberId, f.locationA]);
  const unsupportedInvoice = uuidv7();
  await f.admin.query(`insert into invoices(id,tenant_id,location_id,member_id,payer_kind,invoice_number,
    financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source,gstin,
    issuer_snapshot_version,issuer_legal_name,issuer_legal_address,issuer_state_code,issuer_registration_mode)
    values($1,$2,$3,$4,'member',$5,'2026-27','2026-11-14','2026-11-14',100,0,100,100,'paid','other',
    null,1,'Unsupported 🦄',$6::jsonb,'29','unregistered')`,
  [unsupportedInvoice, f.tenantId, f.locationA, f.memberId, `U-${uuidv7().replaceAll("-", "").slice(-12)}`, JSON.stringify(address)]);
  await f.admin.query(`insert into payments(id,tenant_id,invoice_id,member_id,payer_kind,location_id,
    amount_paise,method,channel,received_at,status) values($1,$2,$3,$4,'member',$5,100,'cash','counter',
    '2026-11-14T00:30:00Z','captured')`, [unsupportedPayment, f.tenantId, unsupportedInvoice, f.memberId, f.locationA]);
});

it("refuses unsupported glyphs without caching a lossy document", async () => {
  const result = await getOrCreateReceipt(f.context(), unsupportedPayment);
  expect(result.ok).toBe(false);
  const rows = await f.admin.query("select id from receipts where tenant_id=$1 and payment_id=$2", [f.tenantId, unsupportedPayment]);
  expect(rows.rowCount).toBe(0);
});
afterAll(async () => { await f?.cleanup(); });

it("embeds Unicode mappings for an issued Hindi and Kannada supplier rather than replacing the identity", async () => {
  const result = await getOrCreateReceipt(f.context(), payment);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.pdf.toString("latin1")).toContain("/ToUnicode");
  const extracted = execFileSync("pdftotext", ["-", "-"], { input: result.pdf, encoding: "utf8" });
  expect(extracted).toContain("भारत");
  expect(extracted).toContain("ಬೆಂಗಳೂರು");
  const cached = await getOrCreateReceipt(f.context(), payment);
  expect(cached.ok && cached.pdf.equals(result.pdf)).toBe(true);
});
