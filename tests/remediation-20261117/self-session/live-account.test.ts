import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";

const request = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === "aqua_self_session" && request.token ? { value: request.token } : undefined }),
  headers: async () => new Headers(),
}));
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { mintSelfServiceSession } from "@/lib/services/self-service-session";
import { readSelfHome } from "@/lib/services/self-home";
import { billingSubjectInTx, readSelfBilling } from "@/lib/services/self-billing";
import { getScopedSelfReceiptInTx } from "@/lib/services/receipts";
import { withTenant } from "@/db/tenant";

let f: Awaited<ReturnType<typeof fixture>>;
const link = randomUUID();
const guardianLink = randomUUID(), guardianPerson = randomUUID(), relationship = randomUUID();
const invoice = randomUUID(), payment = randomUUID();
let memberToken: string, guardianToken: string;
beforeAll(async () => {
  f = await fixture();
  const { rows: [account] } = await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.receptionistId]);
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'members.link.confirm')", [f.tenantId, f.roleId]);
  await f.admin.query("insert into member_account_links(id,tenant_id,user_id,member_id,status,verification_method,verified_by_user_id,account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis) values($1,$2,$3,$4,'active','club_record',$5,$5,now(),'owner_attestation')", [link, f.tenantId, f.receptionistId, f.memberId, f.userId]);
  const session = await mintSelfServiceSession({ tenantId: f.tenantId, userId: f.receptionistId, audience: "member", subjectId: f.memberId, linkIds: [link], accountPhone: account.phone });
  memberToken = session.cookieValue;
  await f.admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Synthetic guardian')", [guardianPerson, f.tenantId]);
  await f.admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship) values($1,$2,$3,$4,'parent')", [relationship, f.tenantId, f.personId, guardianPerson]);
  await f.admin.query("insert into guardian_child_links(id,tenant_id,user_id,guardianship_id,member_id,status,verification_method,verified_by_user_id,account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis) values($1,$2,$3,$4,$5,'active','club_record',$6,$6,now(),'owner_attestation')", [guardianLink, f.tenantId, f.managerId, relationship, f.memberId, f.userId]);
  const guardian = await mintSelfServiceSession({ tenantId: f.tenantId, userId: f.managerId, audience: "guardian", subjectId: null, linkIds: [guardianLink], accountPhone: null });
  guardianToken = guardian.cookieValue;
  await f.admin.query("insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status) values ($1,$2,$3,$4,'F23-RECEIPT','2026-27','2026-11-01','2026-11-30',10000,0,10000,10000,'paid')", [invoice, f.tenantId, f.locationA, f.memberId]);
  await f.admin.query("insert into payments(id,tenant_id,invoice_id,member_id,location_id,amount_paise,method,status) values ($1,$2,$3,$4,$5,10000,'cash','captured')", [payment, f.tenantId, invoice, f.memberId, f.locationA]);
  request.token = memberToken;
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from self_service_session_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from self_service_sessions where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from member_account_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardian_child_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardianships where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it.each(["member", "guardian"] as const)("refuses %s billing and receipt after holder deletion even with a previously resolved scope", async (audience) => {
  request.token = audience === "member" ? memberToken : guardianToken;
  const holder = audience === "member" ? f.receptionistId : f.managerId;
  const resolver = await resolveScopedSelfScope(audience);
  expect(resolver).not.toBeNull();
  const scope = await resolver!.read(async (_tx, live) => live);
  const active = await withTenant(f.tenantId, async tx => ({
    billing: await readSelfBilling(tx, scope, f.memberId),
    receipt: await getScopedSelfReceiptInTx(tx, scope, payment, f.memberId),
  }));
  expect(active.billing?.payments).toHaveLength(1);
  expect(active.receipt.ok).toBe(true);
  await f.admin.query("update users set deleted_at=now() where id=$1", [holder]);
  try {
    const read = vi.fn(async () => "private");
    await expect(resolver!.read(read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    const result = await withTenant(f.tenantId, async tx => ({
      billing: await billingSubjectInTx(tx, scope, f.memberId),
      data: await readSelfBilling(tx, scope, f.memberId),
      receipt: await getScopedSelfReceiptInTx(tx, scope, payment, f.memberId),
    }));
    expect(result.billing).toBeNull();
    expect(result.data).toBeNull();
    expect(result.receipt.ok).toBe(false);
  } finally {
    await f.admin.query("update users set deleted_at=null where id=$1", [holder]);
    request.token = memberToken;
  }
});

it("refuses an attested cookie after its attester is deleted", async () => {
  request.token = memberToken;
  const resolver = await resolveScopedSelfScope("member");
  expect(resolver).not.toBeNull();
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.userId]);
  try {
    const read = vi.fn(async () => "private");
    await expect(resolver!.read(read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  } finally {
    await f.admin.query("update users set deleted_at=null where id=$1", [f.userId]);
  }
});

it("accepts a live attested scoped cookie for home and billing", async () => {
  const resolver = await resolveScopedSelfScope("member");
  expect(resolver).not.toBeNull();
  const result = await resolver!.read(async (tx, scope) => ({ home: await readSelfHome(tx, scope, "member"), billing: await billingSubjectInTx(tx, scope) }));
  expect(result.home.entries).toHaveLength(1);
  expect(result.billing).toBe(f.memberId);
});

it("preserves a live phone-paired member without an attestation", async () => {
  request.token = memberToken;
  const { rows: [account] } = await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.receptionistId]);
  await f.admin.query("update persons set phone=$2 where id=$1", [f.personId, account.phone]);
  await f.admin.query("update member_account_links set verified_phone=$2,verified_phone_verified_at=now(),account_binding_confirmed_by_user_id=null,account_binding_confirmed_at=null,account_binding_basis=null where id=$1", [link, account.phone]);
  try {
    const resolver = await resolveScopedSelfScope("member");
    expect(resolver).not.toBeNull();
    await expect(resolver!.read((tx, scope) => billingSubjectInTx(tx, scope))).resolves.toBe(f.memberId);
  } finally {
    await f.admin.query("update member_account_links set verified_phone=null,verified_phone_verified_at=null,account_binding_confirmed_by_user_id=$2,account_binding_confirmed_at=now(),account_binding_basis='owner_attestation' where id=$1", [link, f.userId]);
    await f.admin.query("update persons set phone=null where id=$1", [f.personId]);
  }
});

it("refuses a private read if the scoped cookie holder is deleted after resolution", async () => {
  const resolver = await resolveScopedSelfScope("member");
  expect(resolver).not.toBeNull();
  await f.admin.query("update users set deleted_at=now() where id=$1", [f.receptionistId]);
  const read = vi.fn(async () => "private");
  try {
    await expect(resolver!.read(read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  } finally {
    await f.admin.query("update users set deleted_at=null where id=$1", [f.receptionistId]);
  }
});
