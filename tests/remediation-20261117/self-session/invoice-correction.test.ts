import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { voidInvoice } from "@/lib/services/invoice-mutations";
import { readBill } from "@/lib/services/cafe-bill-view";
import { listOpenCafeOrders, requestCafeBill } from "@/lib/services/cafe-billing";
import { requestBookingBill, VOIDED_INVOICE_WITH_MONEY_ERROR } from "@/lib/services/booking-billing";
import { getInvoice } from "@/lib/services/invoices";
import { readBookingBill } from "@/lib/services/booking-bill-view";

let f: Awaited<ReturnType<typeof fixture>>;
const cafe = randomUUID(), reversed = randomUUID(), unpaid = randomUUID();
const raceInvoice = randomUUID(), restrictedInvoice = randomUUID();
const order = randomUUID(), line = randomUUID(), payment = randomUUID(), reversal = randomUUID();
const facility = randomUUID(), booking = randomUUID();
beforeAll(async () => {
  f = await fixture();
  // The generic fixture grants settings.manage to every synthetic role; this
  // case models a receptionist without that management grant.
  await f.admin.query("delete from role_permissions where tenant_id=$1 and permission_key='settings.manage' and role_id=(select role_id from tenant_memberships where tenant_id=$1 and user_id=$2)", [f.tenantId, f.receptionistId]);
  for (const [id, number] of [[cafe, "F33-CAFE"], [reversed, "F34-REVERSED"], [unpaid, "F34-UNPAID"], [raceInvoice, "F34-RACE"], [restrictedInvoice, "F34-RESTRICTED"]]) {
    await f.admin.query("insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status) values ($1,$2,$3,$4,$5,'2026-27','2026-11-01','2026-11-30',10000,0,10000,0,'issued')", [id, f.tenantId, f.locationA, f.memberId, number]);
  }
  await f.admin.query("insert into invoice_line_items(id,tenant_id,invoice_id,description,sac_code,amount_paise,tax_rate_bp,tax_paise) values($1,$2,$3,'Booking','1234',10000,0,0)", [randomUUID(), f.tenantId, reversed]);
  await f.admin.query("insert into orders(id,tenant_id,location_id,member_id,status,invoice_id) values($1,$2,$3,$4,'billed',$5)", [order, f.tenantId, f.locationA, f.memberId, cafe]);
  await f.admin.query("insert into order_lines(id,tenant_id,order_id,item_id,item_name,qty,unit_price_paise,tax_rate_bp,sac_code,line_paise,tax_paise) values($1,$2,$3,$4,'Synthetic snack',1,10000,0,'1234',10000,0)", [line, f.tenantId, order, randomUUID()]);
  await f.admin.query("insert into payments(id,tenant_id,invoice_id,member_id,location_id,amount_paise,method,status) values ($1,$2,$3,$4,$5,10000,'cash','captured')", [payment, f.tenantId, reversed, f.memberId, f.locationA]);
  await f.admin.query("insert into payment_reversals(id,tenant_id,payment_id,amount_paise,reason,reversed_by) values ($1,$2,$3,10000,'Correction',$4)", [reversal, f.tenantId, payment, f.userId]);
  await f.admin.query("insert into tenant_features(tenant_id,feature_key,enabled) values($1,'pool.booking',true)", [f.tenantId]);
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'bookings.read'),($1,$2,'invoices.write')", [f.tenantId, f.roleId]);
  await f.admin.query("insert into facilities(id,tenant_id,location_id,name,kind,capacity) values($1,$2,$3,'Court','court',1)", [facility, f.tenantId, f.locationA]);
  await f.admin.query("insert into bookings(id,tenant_id,location_id,facility_id,member_id,starts_at,ends_at,price_paise,status,invoice_id) values($1,$2,$3,$4,$5,'2026-11-20 09:00+00','2026-11-20 10:00+00',10000,'confirmed',$6)", [booking, f.tenantId, f.locationA, facility, f.memberId, reversed]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from bookings where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from facilities where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from payment_reversals where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from order_lines where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from orders where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});
it("projects correction eligibility from café linkage and captured history, not net paid", async () => {
  expect(await getInvoice(f.context(), cafe)).toMatchObject({ correctionEligibility: "cafe" });
  expect(await getInvoice(f.context(), reversed)).toMatchObject({ correctionEligibility: "payment_history" });
  expect(await getInvoice(f.context(), unpaid)).toMatchObject({ correctionEligibility: "eligible" });
  const bill = await readBookingBill(f.context(), booking);
  expect(bill).toMatchObject({ ok: true, bill: { correctionEligibility: "payment_history" } });
});
it("refuses a generic café invoice void without changing its order, invoice or lines", async () => {
  const result = await voidInvoice(f.context(), cafe, "Wrong bill");
  expect(result.ok).toBe(false);
  const data = await f.admin.query("select i.status invoice_status,o.status order_status,o.invoice_id,(select count(*)::int from order_lines where order_id=o.id) lines from invoices i join orders o on o.invoice_id=i.id where i.id=$1", [cafe]);
  expect(data.rows[0]).toMatchObject({ invoice_status: "issued", order_status: "billed", invoice_id: cafe, lines: 1 });
  expect((await listOpenCafeOrders(f.context())).find(row => row.orderId === order)?.amountDuePaise).toBe(10000);
  const bill = await requestCafeBill(f.context(), order);
  expect(bill.ok && bill.bill.invoiceId).toBe(cafe);
  expect((await f.admin.query("select id from audit_log where tenant_id=$1 and entity_id=$2 and action='invoice.void'", [f.tenantId, cafe])).rowCount).toBe(0);
});
it("refuses an invoice whose captured payment was fully reversed", async () => {
  const result = await voidInvoice(f.context(), reversed, "Wrong bill");
  expect(result.ok).toBe(false);
  expect((await f.admin.query("select status from invoices where id=$1", [reversed])).rows[0].status).toBe("issued");
});
it("continues to allow a never-paid ordinary invoice", async () => {
  expect((await voidInvoice(f.context(), unpaid, "Wrong bill")).ok).toBe(true);
});
it("keeps role and tenant restrictions on invoice void", async () => {
  expect((await voidInvoice(f.context(f.receptionistId, "receptionist"), restrictedInvoice, "Wrong bill")).ok).toBe(false);
  expect((await voidInvoice({ ...f.context(), tenantId: f.otherTenant }, restrictedInvoice, "Wrong bill")).ok).toBe(false);
  expect((await f.admin.query("select status from invoices where id=$1", [restrictedInvoice])).rows[0].status).toBe("issued");
});
it("waits for a concurrent captured payment before deciding whether to void", async () => {
  const holder = await f.admin.connect();
  let pending: ReturnType<typeof voidInvoice> | undefined;
  try {
    await holder.query("begin");
    const { rows: [{ pid }] } = await holder.query<{ pid: number }>("select pg_backend_pid() pid");
    await holder.query("select id from invoices where id=$1 for update", [raceInvoice]);
    await holder.query("insert into payments(id,tenant_id,invoice_id,member_id,location_id,amount_paise,method,status) values($1,$2,$3,$4,$5,10000,'cash','captured')", [randomUUID(), f.tenantId, raceInvoice, f.memberId, f.locationA]);
    pending = voidInvoice(f.context(), raceInvoice, "Wrong bill");
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      waiting = (await holder.query("select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [pid])).rowCount !== 0;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
    await holder.query("commit");
    expect((await pending).ok).toBe(false);
  } finally {
    await holder.query("rollback");
    holder.release();
    await pending?.catch(() => undefined);
  }
});
it("refuses reissue of an already-void invoice with fully reversed captured history", async () => {
  await f.admin.query("update invoices set status='void' where id=$1", [reversed]);
  expect(await requestBookingBill(f.context(), booking)).toEqual({ ok: false, error: VOIDED_INVOICE_WITH_MONEY_ERROR });
});
it("shows no amount due on a historical void café bill", async () => {
  await f.admin.query("update invoices set status='void' where id=$1", [cafe]);
  const result = await readBill(f.context(), order);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.bill.amountDuePaise).toBe(0);
});
