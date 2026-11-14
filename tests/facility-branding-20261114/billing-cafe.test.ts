import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "@/tests/db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { createOrder, finalizeOrder } from "@/lib/services/orders";
import { readBill } from "@/lib/services/cafe-bill-view";
import { getInvoice } from "@/lib/services/invoices";
import { readBookingBill } from "@/lib/services/booking-bill-view";

const tenantId = asTenantId(uuidv7());
const userId = asUserId(uuidv7());
const locationId = uuidv7();
const roleId = uuidv7();
const categoryId = uuidv7();
const itemId = uuidv7();
const registrationId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const facilityId = uuidv7();
const address = { line1: "Site road", line2: null, city: "Bengaluru", postalCode: "560001" };

beforeAll(async () => {
  await admin.query("insert into tenants(id,slug,name,status,gstin) values($1,$2,'Cafe test','active',null)", [tenantId, `cafe-${tenantId}`]);
  await admin.query("insert into users(id,phone) values($1,$2)", [userId, `+91${String(BigInt(`0x${userId.replaceAll('-', '').slice(-10)}`) % 10000000000n).padStart(10, '0')}`]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'owner','Owner','/owner',0)", [roleId, tenantId]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)", [uuidv7(), tenantId, userId, roleId]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Cafe',true)", [locationId, tenantId]);
  await admin.query("insert into facilities(id,tenant_id,location_id,name,kind,capacity) values($1,$2,$3,'Court','court',1)", [facilityId, tenantId, locationId]);
  await admin.query("insert into tenant_features(tenant_id,feature_key,enabled) values($1,'cafe.pos',true)", [tenantId]);
  await admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Member')", [personId, tenantId]);
  await admin.query("insert into members(id,tenant_id,person_id,location_id,member_code,status) values($1,$2,$3,$4,$5,'active')", [memberId, tenantId, personId, locationId, `MEM-${memberId}`]);
  await admin.query("insert into menu_categories(id,tenant_id,location_id,name) values($1,$2,$3,'Drinks')", [categoryId, tenantId, locationId]);
  await admin.query("insert into menu_items(id,tenant_id,location_id,category_id,name,price_paise,tax_rate_bp,sac_code) values($1,$2,$3,$4,'Drink',10000,500,'996331')", [itemId, tenantId, locationId, categoryId]);
  await admin.query("insert into billing_registrations(id,tenant_id,legal_name,legal_address,state_code,gstin) values($1,$2,'Site issuer',$3::jsonb,'29','29ABCDE1234F1Z5')", [registrationId, tenantId, JSON.stringify(address)]);
  await admin.query("insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode,registration_id) values($1,$2,'29',true,'registered_override',$3)", [tenantId, locationId, registrationId]);
});
beforeEach(async () => {
  await admin.query("update location_billing_settings set registration_id=$1 where tenant_id=$2 and location_id=$3", [registrationId, tenantId, locationId]);
});
afterAll(async () => {
  await admin.query("delete from bookings where tenant_id=$1", [tenantId]);
  await admin.query("delete from order_lines where tenant_id=$1", [tenantId]);
  await admin.query("delete from orders where tenant_id=$1", [tenantId]);
  await admin.query("delete from invoice_line_items where tenant_id=$1", [tenantId]);
  await admin.query("delete from invoices where tenant_id=$1", [tenantId]);
  await admin.query("delete from menu_items where tenant_id=$1", [tenantId]);
  await admin.query("delete from menu_categories where tenant_id=$1", [tenantId]);
  await admin.query("delete from members where tenant_id=$1", [tenantId]);
  await admin.query("delete from persons where tenant_id=$1", [tenantId]);
  await admin.query("delete from facilities where tenant_id=$1", [tenantId]);
  await admin.query("delete from tenant_features where tenant_id=$1", [tenantId]);
  await admin.query("delete from locations where tenant_id=$1", [tenantId]);
  await admin.query("delete from tenant_memberships where tenant_id=$1", [tenantId]);
  await admin.query("delete from roles where tenant_id=$1", [tenantId]);
  await admin.query("delete from tenants where id=$1", [tenantId]);
  await admin.end();
});

it("finalizes against the order's pinned issuer even if a privileged writer changes the current identity", async () => {
  const created = await createOrder({ tenantId, userId }, { locationId, memberId, lines: [{ itemId, qty: 1 }] });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const replacement = uuidv7();
  await admin.query("insert into billing_registrations(id,tenant_id,legal_name,legal_address,state_code,gstin) values($1,$2,'Changed issuer',$3::jsonb,'29','29ABCDE1234F1Z6')", [replacement, tenantId, JSON.stringify(address)]);
  await admin.query("update location_billing_settings set registration_id=$1 where tenant_id=$2 and location_id=$3", [replacement, tenantId, locationId]);
  const billed = await finalizeOrder({ tenantId, userId }, created.orderId);
  expect(billed.ok).toBe(true);
  if (!billed.ok) return;
  const rows = await admin.query("select gstin,issuer_legal_name,total_paise from invoices where id=$1", [billed.invoiceId]);
  expect(rows.rows[0]).toMatchObject({ gstin: "29ABCDE1234F1Z5", issuer_legal_name: "Site issuer", total_paise: "10500" });
  const view = await readBill({ tenantId, userId }, created.orderId);
  expect(view.ok).toBe(true);
  if (view.ok) expect(view.bill).toMatchObject({ issuer: { legalName: "Site issuer", gstin: "29ABCDE1234F1Z5", stateCode: "29", legalAddress: address } });
  const invoice = await getInvoice({ tenantId, userId }, billed.invoiceId);
  expect(invoice).toMatchObject({ issuer: { legalName: "Site issuer", gstin: "29ABCDE1234F1Z5", stateCode: "29", legalAddress: address } });
  const bookingId = uuidv7();
  await admin.query("insert into bookings(id,tenant_id,location_id,facility_id,member_id,starts_at,ends_at,price_paise,status,invoice_id) values($1,$2,$3,$4,$5,'2026-11-20T10:00:00Z','2026-11-20T11:00:00Z',10500,'confirmed',$6)", [bookingId, tenantId, locationId, facilityId, memberId, billed.invoiceId]);
  const booking = await readBookingBill({ tenantId, userId }, bookingId);
  expect(booking.ok).toBe(true);
  if (booking.ok) expect(booking.bill).toMatchObject({ issuer: { legalName: "Site issuer", gstin: "29ABCDE1234F1Z5", stateCode: "29", legalAddress: address } });
});

it("places an enabled-site café order with its issuer and tax pinned", async () => {
  const result = await createOrder({ tenantId, userId }, { locationId, lines: [{ itemId, qty: 1 }] });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.totalPaise).toBe(10500);
  const rows = await admin.query("select issuer_snapshot_version,issuer_gstin,issuer_legal_name,issuer_legal_address,issuer_state_code from orders where id=$1", [result.orderId]);
  expect(rows.rows[0]).toMatchObject({ issuer_snapshot_version: 1, issuer_gstin: "29ABCDE1234F1Z5", issuer_legal_name: "Site issuer", issuer_legal_address: address, issuer_state_code: "29" });
});

it("refuses to pair a legacy order with an enabled-site issuer", async () => {
  await admin.query("update location_billing_settings set facility_billing_enabled=false where tenant_id=$1 and location_id=$2", [tenantId, locationId]);
  const created = await createOrder({ tenantId, userId }, { locationId, memberId, lines: [{ itemId, qty: 1 }] });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  await admin.query("update location_billing_settings set facility_billing_enabled=true where tenant_id=$1 and location_id=$2", [tenantId, locationId]);
  const billed = await finalizeOrder({ tenantId, userId }, created.orderId);
  expect(billed.ok).toBe(false);
});

it("refuses order placement when the displayed tax registration is stale", async () => {
  const created = await createOrder({ tenantId, userId }, { locationId, lines: [{ itemId, qty: 1 }], expectedTaxRegistered: false });
  expect(created.ok).toBe(false);
});
