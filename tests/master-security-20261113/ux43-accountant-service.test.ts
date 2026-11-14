import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { getMemberPayerView, getMemberDetail, listMembers, updateMember } from "@/lib/services/people";
import { getInvoice, listMemberInvoices } from "@/lib/services/invoices";
import { getOrCreateReceipt } from "@/lib/services/receipts";
import { getEnquiryFunnel } from "@/lib/services/owner-reports";

let f: Awaited<ReturnType<typeof fixture>>;
const otherPerson = randomUUID(), otherMember = randomUUID();
const invoiceA = randomUUID(), invoiceB = randomUUID();
const paymentB = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("update roles set key='accountant' where tenant_id=$1 and id=(select role_id from tenant_memberships where tenant_id=$1 and user_id=$2)", [f.tenantId, f.receptionistId]);
  await f.admin.query("update tenant_memberships set all_locations=false where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]);
  await f.admin.query("insert into membership_locations(id,tenant_id,membership_id,location_id) select $1,$2,id,$3 from tenant_memberships where tenant_id=$2 and user_id=$4", [randomUUID(), f.tenantId, f.locationA, f.receptionistId]);
  await f.admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Other facility member')", [otherPerson, f.tenantId]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values($1,$2,$3,$4,'active','OTHER')", [otherMember, f.tenantId, otherPerson, f.locationB]);
  await f.admin.query("insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status,source) values($1,$3,$4,$6,'A-1','2026-27','2026-11-01','2026-11-30',10000,0,10000,0,'issued','membership'),($2,$3,$5,$7,'B-1','2026-27','2026-11-01','2026-11-30',10000,0,10000,0,'issued','membership')", [invoiceA, invoiceB, f.tenantId, f.locationA, f.locationB, f.memberId, otherMember]);
  await f.admin.query("insert into payments(id,tenant_id,invoice_id,member_id,location_id,amount_paise,method,channel,status,received_at) values($1,$2,$3,$4,$5,10000,'cash','counter','captured',now())", [paymentB, f.tenantId, invoiceB, otherMember, f.locationB]);
  await f.admin.query("insert into enquiries(id,tenant_id,full_name,source,stage,location_id,created_at) values($1,$4,'Site A','phone','new',$5,'2026-11-13T10:00Z'),($2,$4,'Site B','phone','new',$6,'2026-11-13T10:00Z'),($3,$4,'Unlocated','phone','new',null,'2026-11-13T10:00Z')", [randomUUID(), randomUUID(), randomUUID(), f.tenantId, f.locationA, f.locationB]);
});

it.each(["receptionist", "coach", "worker", "accountant", "admin"])("restricts direct member and invoice reads for %s with either switch setting", async (role) => {
  await f.admin.query("update roles set key=$1 where tenant_id=$2 and id=(select role_id from tenant_memberships where tenant_id=$2 and user_id=$3)", [role, f.tenantId, f.receptionistId]);
  const ctx = { ...f.context(f.receptionistId, "receptionist"), roleKey: role, allLocations: false, locationIds: [f.locationA] };
  for (const enabled of [false, true]) {
    await f.admin.query("delete from config_values where tenant_id=$1 and key='access.location_scoped_staff'", [f.tenantId]);
    if (enabled) await f.admin.query("insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true'::jsonb)", [randomUUID(), f.tenantId]);
    expect(await getMemberDetail(ctx, f.memberId)).not.toBeNull();
    expect(await getMemberDetail(ctx, otherMember)).toBeNull();
    expect(await getInvoice(ctx, invoiceA)).not.toBeNull();
    expect(await getInvoice(ctx, invoiceB)).toBeNull();
    expect(await listMemberInvoices(ctx, otherMember)).toEqual([]);
    expect((await listMembers(ctx, { locationId: f.locationB })).map((row) => row.memberId)).not.toContain(otherMember);
    expect(await getOrCreateReceipt(ctx, paymentB)).toMatchObject({ ok: false, error: "Receipt not found." });
    expect(await updateMember(ctx, otherMember, { fullName: "Unauthorized edit" })).toMatchObject({ ok: false });
    const report = await getEnquiryFunnel(ctx, { from: "2026-11-01", to: "2026-12-01" });
    expect(report.find((row) => row.source === "phone")?.total).toBe(2);
  }
});

it("honors an explicitly narrowed all-location owner context when the legacy switch is off", async () => {
  await f.admin.query("delete from config_values where tenant_id=$1 and key='access.location_scoped_staff'", [f.tenantId]);
  const ctx = { ...f.context(), allLocations: false, locationIds: [f.locationA] };
  expect(await getInvoice(ctx, invoiceA)).not.toBeNull();
  expect(await getInvoice(ctx, invoiceB)).toBeNull();
});

it("does not expose a direct invoice read to a soft-deleted user with an active membership", async () => {
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.userId]);
  try { expect(await getInvoice(f.context(), invoiceA)).toBeNull(); }
  finally { await f.admin.query("update users set deleted_at=null where id=$1", [f.userId]); }
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from config_values where tenant_id=$1 and key='access.location_scoped_staff'", [f.tenantId]);
  await f.admin.query("delete from enquiries where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

describe("UX43 direct service boundaries", () => {
  it.each([false, true])("enforces accountant scope when the setting is %s", async (enabled) => {
    await f.admin.query("update roles set key='accountant' where tenant_id=$1 and id=(select role_id from tenant_memberships where tenant_id=$1 and user_id=$2)", [f.tenantId, f.receptionistId]);
    await f.admin.query("delete from config_values where tenant_id=$1 and key='access.location_scoped_staff'", [f.tenantId]);
    if (enabled) await f.admin.query("insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true'::jsonb)", [randomUUID(), f.tenantId]);
    const ctx = { ...f.context(f.receptionistId, "receptionist"), roleKey: "accountant", allLocations: false, locationIds: [f.locationA] };
    expect(await getMemberPayerView(ctx, f.memberId)).not.toBeNull();
    expect(await getMemberPayerView(ctx, otherMember)).toBeNull();
    expect(await getMemberDetail(ctx, otherMember)).toBeNull();
    expect((await updateMember(ctx, otherMember, { fullName: "Unauthorized edit" })).ok).toBe(false);
    expect(await getMemberPayerView(f.context(), otherMember)).not.toBeNull();
    expect(await getMemberPayerView(f.context(f.managerId, "manager"), otherMember)).toBeNull();
    expect(await getInvoice(ctx, invoiceA)).not.toBeNull();
    expect(await getInvoice(ctx, invoiceB)).toBeNull();
    expect(await listMemberInvoices(ctx, otherMember)).toEqual([]);
    expect(await getInvoice(f.context(), invoiceB)).not.toBeNull();
    expect(await getInvoice(f.context(f.managerId, "manager"), invoiceB)).toBeNull();
    expect((await getEnquiryFunnel(f.context(), { from: "2026-11-01", to: "2026-12-01" })).find((row) => row.source === "phone")?.total).toBe(3);
    expect((await getEnquiryFunnel(f.context(f.managerId, "manager"), { from: "2026-11-01", to: "2026-12-01" })).find((row) => row.source === "phone")?.total).toBe(1);
  });
});
