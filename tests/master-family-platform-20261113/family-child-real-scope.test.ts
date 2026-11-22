import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
const request = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "aqua_self_session" && request.token ? { value: request.token } : undefined }), headers: async () => new Headers() }));
import { mintSelfServiceSession } from "@/lib/services/self-service-session";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { readSelfHome } from "@/lib/services/self-home";
import { billingSubjectInTx } from "@/lib/services/self-billing";
import { readAuthorizedBrandingTarget } from "@/lib/services/branding-target";
import { getScopedSelfReceiptInTx } from "@/lib/services/receipts";

let f: Awaited<ReturnType<typeof fixture>>, second: string, unrelated: string, unlinked: string, linkIds: string[], firstPayment: string;
beforeAll(async () => {
  f = await fixture();
  const { rows: [actor] } = await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.userId]);
  const guardian = randomUUID(), secondPerson = randomUUID(), otherPerson = randomUUID(), unlinkedPerson = randomUUID(), otherLocation = randomUUID();
  second = randomUUID(); unrelated = randomUUID(); unlinked = randomUUID();
  await f.admin.query("insert into persons(id,tenant_id,full_name,phone) values ($1,$4,'Synthetic guardian',$6),($2,$4,'Second child',null),($3,$5,'Unlinked child',null)", [guardian, secondPerson, otherPerson, f.tenantId, f.otherTenant, actor.phone]);
  await f.admin.query("insert into locations(id,tenant_id,name,is_primary) values ($1,$2,'Other',true)", [otherLocation, f.otherTenant]);
  await f.admin.query("insert into persons(id,tenant_id,full_name) values ($1,$2,'Same-club unlinked child')", [unlinkedPerson, f.tenantId]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values ($1,$2,$3,$4,'active','UNLINKED')", [unlinked, f.tenantId, unlinkedPerson, f.locationA]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values ($1,$3,$4,$5,'active','SECOND'),($2,$6,$7,$8,'active','OTHER')", [second, unrelated, f.tenantId, secondPerson, f.locationA, f.otherTenant, otherPerson, otherLocation]);
  const guardianships = [randomUUID(), randomUUID()]; linkIds = [randomUUID(), randomUUID()];
  for (const [index, child] of [f.personId, secondPerson].entries()) {
    await f.admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship) values ($1,$2,$3,$4,'parent')", [guardianships[index], f.tenantId, child, guardian]);
    await f.admin.query("insert into guardian_child_links(id,tenant_id,user_id,guardianship_id,member_id,status,verification_method,verified_by_user_id,verified_phone,verified_phone_verified_at) values ($1,$2,$3,$4,$5,'active','club_record',$3,$6,now())", [linkIds[index], f.tenantId, f.userId, guardianships[index], index === 0 ? f.memberId : second, actor.phone]);
  }
  const invoice = randomUUID(); firstPayment = randomUUID();
  await f.admin.query("insert into invoices(id,tenant_id,location_id,member_id,invoice_number,financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,paid_paise,status) values ($1,$2,$3,$4,'SYNTH-CHILD-1','2026-27','2026-11-01','2026-11-30',10000,0,10000,10000,'paid')", [invoice, f.tenantId, f.locationA, f.memberId]);
  await f.admin.query("insert into payments(id,tenant_id,invoice_id,member_id,location_id,amount_paise,method,status) values ($1,$2,$3,$4,$5,10000,'cash','captured')", [firstPayment, f.tenantId, invoice, f.memberId, f.locationA]);
  const session = await mintSelfServiceSession({ tenantId: f.tenantId, userId: f.userId, audience: "guardian", subjectId: null, linkIds, accountPhone: actor.phone });
  request.token = session.cookieValue;
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from self_service_session_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from self_service_sessions where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardian_child_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardianships where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});
it("reads only the two live linked child identities and denies an unrelated tenant child", async () => {
  const resolver = await resolveScopedSelfScope("guardian");
  expect(resolver).not.toBeNull();
  const result = await resolver!.read(async (tx, scope) => ({ home: await readSelfHome(tx, scope, "guardian"), first: await billingSubjectInTx(tx, scope, f.memberId), second: await billingSubjectInTx(tx, scope, second), other: await billingSubjectInTx(tx, scope, unrelated), unlinked: await billingSubjectInTx(tx, scope, unlinked) }));
  expect(result.home.entries.map((entry) => entry.memberCode).sort()).toEqual(["FIX", "SECOND"]);
  expect(result.first).toBe(f.memberId);
  expect(result.second).toBe(second);
  expect(result.other).toBeNull();
  expect(result.unlinked).toBeNull();
  expect(await readAuthorizedBrandingTarget(f.tenantId, "guardian", async () => "authorized")).toBe("authorized");
  expect(await readAuthorizedBrandingTarget(f.otherTenant, "guardian", async () => "foreign")).toBeNull();
});
it("only serves a captured receipt for the selected authorized child", async () => {
  const resolver = await resolveScopedSelfScope("guardian");
  expect(resolver).not.toBeNull();
  const results = await resolver!.read(async (tx, scope) => ({
    own: await getScopedSelfReceiptInTx(tx, scope, firstPayment, f.memberId),
    sibling: await getScopedSelfReceiptInTx(tx, scope, firstPayment, second),
    unlinked: await getScopedSelfReceiptInTx(tx, scope, firstPayment, unlinked),
  }));
  expect(results.own.ok).toBe(true);
  if (results.own.ok) expect(results.own.fileName).toContain("SYNTH-CHILD-1");
  expect(results.sibling.ok).toBe(false);
  expect(results.unlinked.ok).toBe(false);
});
it("refuses the bound session after a linked child is revoked", async () => {
  await f.admin.query("update guardian_child_links set status='revoked',revoked_at=now(),revoked_by_user_id=$1 where id=$2", [f.userId, linkIds[1]]);
  const resolver = await resolveScopedSelfScope("guardian");
  expect(resolver).not.toBeNull();
  await expect(resolver!.read((tx, scope) => readSelfHome(tx, scope, "guardian"))).rejects.toThrow();
  expect(await readAuthorizedBrandingTarget(f.tenantId, "guardian", async () => "private")).toBeNull();
});
