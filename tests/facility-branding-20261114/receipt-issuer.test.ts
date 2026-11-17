import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { fixture } from "../remediation-20261112/fixture";
import { getOrCreateReceipt } from "@/lib/services/receipts";

let f: Awaited<ReturnType<typeof fixture>>;
const currentPayment = uuidv7();
const legacyPayment = uuidv7();
const originalAddress = { line1: "Snapshot Road 11", line2: null, city: "Bengaluru", postalCode: "560001" };
const originalName = "Original Facility Legal";

beforeAll(async () => {
  f = await fixture();
  await f.admin.query(`update tenants set gstin='29ABCDE1234F1Z5',billing_legal_name=$2,
    billing_legal_address=$3::jsonb,billing_state_code='29' where id=$1`,
  [f.tenantId, originalName, JSON.stringify(originalAddress)]);
  await f.admin.query(`insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode)
    values($1,$2,'29',true,'inherit')`, [f.tenantId, f.locationA]);
  for (const [version, payment] of [[1, currentPayment], [0, legacyPayment]] as const) {
    const invoice = uuidv7();
    // The legacy row belongs to an unconfigured site; the v1 document belongs
    // to the explicitly enabled physical site. Both fixture records are paid.
    const location = version === 1 ? f.locationA : f.locationB;
    await f.admin.query(`insert into invoices(id,tenant_id,location_id,member_id,payer_kind,invoice_number,
      financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source,gstin,
      issuer_snapshot_version,issuer_legal_name,issuer_legal_address,issuer_state_code,issuer_registration_mode)
      values($1,$2,$3,$4,'member',$5,'2026-27','2026-11-14','2026-11-14',100,0,100,100,'paid','other',
      '29ABCDE1234F1Z5',$6,$7,$8::jsonb,$9,$10)`,
    [invoice, f.tenantId, location, f.memberId, `R-${uuidv7().replaceAll("-", "").slice(-12)}`, version,
      version === 1 ? originalName : null, version === 1 ? JSON.stringify(originalAddress) : null,
      version === 1 ? "29" : null, version === 1 ? "registered" : null]);
    await f.admin.query(`insert into payments(id,tenant_id,invoice_id,member_id,payer_kind,location_id,
      amount_paise,method,channel,received_at,status) values($1,$2,$3,$4,'member',$5,100,'cash','counter',
      '2026-11-14T00:30:00Z','captured')`, [payment, f.tenantId, invoice, f.memberId, location]);
  }
  // A later valid same-state profile change must not become the issuer of an
  // already issued v1 invoice whose receipt has never yet been generated.
  await f.admin.query(`update tenants set name='Current Club Display',billing_legal_name='Later Legal Name',
    billing_legal_address=$2::jsonb where id=$1`,
  [f.tenantId, JSON.stringify({ ...originalAddress, line1: "Later Road 99" })]);
});

afterAll(async () => { await f?.cleanup(); });

describe("Receipt issuer from issued invoice", () => {
  it("uses frozen legal name and address before the first PDF generation", async () => {
    const result = await getOrCreateReceipt(f.context(), currentPayment);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const text = result.pdf.toString("latin1");
    expect(text).toContain(originalName);
    expect(text).toContain("Snapshot Road 11");
    expect(text).not.toContain("Later Legal Name");
    expect(text).not.toContain("Later Road 99");
  });

  it("returns an existing receipt's exact bytes after another profile change", async () => {
    const first = await getOrCreateReceipt(f.context(), currentPayment);
    expect(first.ok).toBe(true);
    await f.admin.query("update tenants set name='Another Display' where id=$1", [f.tenantId]);
    const second = await getOrCreateReceipt(f.context(), currentPayment);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Fixture receipt missing");
    expect(second.pdf.equals(first.pdf)).toBe(true);
  });

  it("keeps legacy uncached receipt behavior without invented issuer details", async () => {
    const result = await getOrCreateReceipt(f.context(), legacyPayment);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const text = result.pdf.toString("latin1");
    expect(text).toContain("Another Display");
    expect(text).not.toContain(originalName);
    expect(text).not.toContain("Snapshot Road 11");
  });
});
