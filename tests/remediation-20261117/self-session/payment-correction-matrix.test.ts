import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { recordPayment } from "@/lib/services/payments";
import { reversePayment } from "@/lib/services/payment-reversals";
import { voidInvoice } from "@/lib/services/invoice-mutations";
import { getInvoice } from "@/lib/services/invoices";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from payment_reversals where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});
async function invoice() {
  const id = randomUUID();
  await f.admin.query("insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status) values($1,$2,$3,$4,$5,'2026-27','2026-11-01','2026-11-30',10000,0,10000,0,'issued')", [id, f.tenantId, f.locationA, f.memberId, `F34-${id.slice(0, 8)}`]);
  return id;
}
it.each([
  { name: "partial payment", capture: 4000, reverse: 0 },
  { name: "full payment", capture: 10000, reverse: 0 },
  { name: "partial reversal", capture: 10000, reverse: 4000 },
  { name: "full reversal", capture: 10000, reverse: 10000 },
])("refuses void after $name and retains financial history", async ({ capture, reverse }) => {
  const id = await invoice();
  const paid = await recordPayment(f.context(), { invoiceId: id, amountPaise: capture, method: "cash" });
  expect(paid.ok).toBe(true);
  if (!paid.ok) throw new Error(paid.error);
  if (reverse) {
    const result = await reversePayment(f.context(), { paymentId: paid.id, amountPaise: reverse, reason: "Correction" });
    expect(result.ok).toBe(true);
  }
  expect(await getInvoice(f.context(), id)).toMatchObject({ correctionEligibility: "payment_history" });
  expect((await voidInvoice(f.context(), id, "Wrong bill")).ok).toBe(false);
  const rows = await f.admin.query("select p.id,p.status,(select count(*)::int from payment_reversals r where r.payment_id=p.id) reversals from payments p where p.id=$1", [paid.id]);
  expect(rows.rows[0]).toMatchObject({ id: paid.id, status: "captured", reversals: reverse ? 1 : 0 });
  const audits = await f.admin.query("select action from audit_log where tenant_id=$1 and entity_id=$2", [f.tenantId, paid.id]);
  expect(audits.rows.map(row => row.action)).toContain("payment.record");
  if (reverse) expect(audits.rows.map(row => row.action)).toContain("payment.reverse");
  expect((await f.admin.query("select id from audit_log where tenant_id=$1 and entity_id=$2 and action='invoice.void'", [f.tenantId, id])).rowCount).toBe(0);
});
it("serializes real capture and void so only one can succeed", async () => {
  const id = await invoice();
  const [capture, voided] = await Promise.all([
    recordPayment(f.context(), { invoiceId: id, amountPaise: 10000, method: "cash" }),
    voidInvoice(f.context(), id, "Wrong bill"),
  ]);
  expect(Number(capture.ok) + Number(voided.ok)).toBe(1);
  const { rows: [row] } = await f.admin.query("select status,paid_paise,(select count(*)::int from payments where invoice_id=$1 and status='captured') payments from invoices where id=$1", [id]);
  if (capture.ok) expect(row).toMatchObject({ status: "paid", payments: 1 });
  else expect(row).toMatchObject({ status: "void", payments: 0 });
});
