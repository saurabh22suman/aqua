import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "@/tests/remediation-20261112/fixture";
const request = vi.hoisted(() => ({ headers: new Headers(), selfToken: "" }));
vi.mock("next/headers", () => ({ headers: async () => request.headers, cookies: async () => ({ get: (name: string) => name === "aqua_self_session" && request.selfToken ? { value: request.selfToken } : undefined }) }));
import { ensureBaUserForPhone, pinLogin, setCredential } from "@/lib/services/credentials";
import { readAuthorizedBrandingTarget } from "@/lib/services/branding-target";
import { resolveSelfScope } from "@/lib/auth/self-scope";

let f: Awaited<ReturnType<typeof fixture>>, baId: string;
beforeAll(async () => {
  f = await fixture();
  const { rows: [user] } = await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.receptionistId]);
  baId = await ensureBaUserForPhone(user.phone);
  await setCredential(baId, "123456");
  const signed = await pinLogin(user.phone, "123456");
  request.headers = new Headers({ cookie: signed.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'members.link.confirm')", [f.tenantId, f.roleId]);
  await f.admin.query("insert into member_account_links(id,tenant_id,user_id,member_id,status,verification_method,verified_by_user_id,account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis) values($1,$2,$3,$4,'active','club_record',$5,$5,now(),'owner_attestation')", [randomUUID(), f.tenantId, f.receptionistId, f.memberId, f.userId]);
  const guardian = randomUUID(), guardianship = randomUUID();
  await f.admin.query("insert into persons(id,tenant_id,full_name,phone) values($1,$2,'Synthetic guardian',$3)", [guardian, f.tenantId, user.phone]);
  await f.admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship) values($1,$2,$3,$4,'parent')", [guardianship, f.tenantId, f.personId, guardian]);
  await f.admin.query("insert into guardian_child_links(id,tenant_id,user_id,guardianship_id,member_id,status,verification_method,verified_by_user_id,verified_phone,verified_phone_verified_at) values($1,$2,$3,$4,$5,'active','club_record',$6,$7,now())", [randomUUID(), f.tenantId, f.receptionistId, guardianship, f.memberId, f.userId, user.phone]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from guardian_child_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardianships where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from member_account_links where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});
it.each(["member", "guardian"] as const)("authorizes the exact live staff-derived %s target and rejects another tenant", async (audience) => {
  const resolver = await resolveSelfScope(audience, null);
  expect(resolver?.scope.kind).toBe("staff_session");
  expect(await resolver?.read(async () => "live")).toBe("live");
  expect(await readAuthorizedBrandingTarget(f.tenantId, audience, async () => "allowed")).toBe("allowed");
  expect(await readAuthorizedBrandingTarget(f.otherTenant, audience, async () => "foreign")).toBeNull();
});
it.each(["member", "guardian"] as const)("fails closed for expired, revoked, and dead-self-cookie %s staff access", async (audience) => {
  await f.admin.query("update ba_session set created_at=now()-interval '13 hours' where user_id=$1", [baId]);
  expect(await readAuthorizedBrandingTarget(f.tenantId, audience, async () => "private")).toBeNull();
  await f.admin.query("update ba_session set created_at=now() where user_id=$1", [baId]);
  await f.admin.query("update tenant_memberships set status='revoked' where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]);
  expect(await readAuthorizedBrandingTarget(f.tenantId, audience, async () => "private")).toBeNull();
  await f.admin.query("update tenant_memberships set status='active' where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]);
  request.selfToken = `s1.${randomUUID()}.${"a".repeat(64)}`;
  expect(await readAuthorizedBrandingTarget(f.tenantId, audience, async () => "private")).toBeNull();
  request.selfToken = "";
});
