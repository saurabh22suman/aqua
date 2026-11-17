import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";

const request = vi.hoisted(() => ({ headers: new Headers(), selfToken: "" }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => request.selfToken ? { value: request.selfToken } : undefined }),
}));
import { ensureBaUserForPhone, pinLogin, setCredential } from "@/lib/services/credentials";
import { resolveSelfScope } from "@/lib/auth/self-scope";

let f: Awaited<ReturnType<typeof fixture>>;
let baId: string;
const link = randomUUID();
beforeAll(async () => {
  f = await fixture();
  const { rows: [user] } = await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.receptionistId]);
  baId = await ensureBaUserForPhone(user.phone);
  await setCredential(baId, "123456");
  const signed = await pinLogin(user.phone, "123456");
  expect(signed.status).toBe(200);
  request.headers = new Headers({ cookie: signed.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'members.link.confirm')", [f.tenantId, f.roleId]);
  await f.admin.query("insert into member_account_links(id,tenant_id,user_id,member_id,status,verification_method,verified_by_user_id,account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis) values($1,$2,$3,$4,'active','club_record',$5,$5,now(),'owner_attestation')", [link, f.tenantId, f.receptionistId, f.memberId, f.userId]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from member_account_links where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("refuses a receptionist session older than its hard cap", async () => {
  await f.admin.query("update ba_session set created_at=now()-interval '13 hours' where user_id=$1", [baId]);
  const resolver = await resolveSelfScope("member", null);
  expect(resolver).toBeNull();
});

it("refuses the read when the exact staff membership was revoked after resolution", async () => {
  await f.admin.query("update ba_session set created_at=now() where user_id=$1", [baId]);
  const resolver = await resolveSelfScope("member", null);
  expect(resolver).not.toBeNull();
  if (!resolver) return;
  await expect(resolver.read(async () => "authorized")).resolves.toBe("authorized");
  const read = vi.fn(async () => "private");
  await f.admin.query("update tenant_memberships set status='revoked' where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]);
  await expect(resolver.read(read)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

it.each(["membership", "role", "user"] as const)("refuses after the resolved %s is soft-deleted", async (kind) => {
  await f.admin.query("update tenant_memberships set status='active',deleted_at=null where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]);
  await f.admin.query("update users set deleted_at=null where id=$1", [f.receptionistId]);
  await f.admin.query("update roles set deleted_at=null where id=(select role_id from tenant_memberships where tenant_id=$1 and user_id=$2)", [f.tenantId, f.receptionistId]);
  const resolver = await resolveSelfScope("member", null);
  expect(resolver).not.toBeNull();
  if (!resolver) return;
  if (kind === "membership") await f.admin.query("update tenant_memberships set deleted_at=now() where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]);
  if (kind === "role") await f.admin.query("update roles set deleted_at=now() where id=(select role_id from tenant_memberships where tenant_id=$1 and user_id=$2)", [f.tenantId, f.receptionistId]);
  if (kind === "user") await f.admin.query("update users set deleted_at=now() where id=$1", [f.receptionistId]);
  const read = vi.fn(async () => "private");
  await expect(resolver.read(read)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

it("does not fall through to staff when a dead self cookie is present", async () => {
  await f.admin.query("update users set deleted_at=null where id=$1", [f.receptionistId]);
  request.selfToken = `s1.${randomUUID()}.${"a".repeat(64)}`;
  try { expect(await resolveSelfScope("member", null)).toBeNull(); }
  finally { request.selfToken = ""; }
});

it("refuses when the membership role changes between resolve and read", async () => {
  const resolver = await resolveSelfScope("member", null);
  expect(resolver).not.toBeNull();
  if (!resolver) return;
  await f.admin.query("update tenant_memberships set role_id=$1 where tenant_id=$2 and user_id=$3", [f.roleId, f.tenantId, f.receptionistId]);
  const read = vi.fn(async () => "private");
  await expect(resolver.read(read)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
