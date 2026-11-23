import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { readSelfWorkspaceRoles, readStaffWorkspaceRoles } from "@/lib/auth/workspace-roles";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { ensureBaUserForPhone, pinLogin, setCredential } from "@/lib/services/credentials";
import { mintSelfServiceSession } from "@/lib/services/self-service-session";
import { ACTIVE_CLUB_COOKIE } from "@/lib/auth/active-club";
import { homeForSessionAction } from "@/lib/actions/auth-ui";
import { lastBusinessKey } from "@/lib/services/workspace-opening";

const request = vi.hoisted(() => ({ headers: new Headers(), selfToken: "", preferences: new Map<string, string>(), set: vi.fn(), delete: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => name === "aqua_self_session" && request.selfToken
      ? { value: request.selfToken } : request.preferences.has(name) ? { value: request.preferences.get(name) } : undefined,
    set: request.set,
    delete: request.delete,
  }),
}));

let f: Awaited<ReturnType<typeof fixture>>;
let staffCookie: string;
let memberToken: string;
let betterAuthId: string;
const memberLink = randomUUID();
const anotherMembership = randomUUID();
const sameRole = randomUUID();
const anotherRole = randomUUID();

beforeAll(async () => {
  f = await fixture();
  const { rows: [person] } = await f.admin.query<{ phone: string }>(
    "select phone from users where id=$1", [f.receptionistId],
  );
  const identity = await ensureBaUserForPhone(person.phone);
  betterAuthId = identity;
  await setCredential(identity, "123456");
  const login = await pinLogin(person.phone, "123456");
  expect(login.status).toBe(200);
  staffCookie = login.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");

  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'members.link.confirm')", [f.tenantId, f.roleId]);
  await f.admin.query(`insert into member_account_links
    (id,tenant_id,user_id,member_id,status,verification_method,verified_by_user_id,
      account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis)
    values($1,$2,$3,$4,'active','club_record',$5,$5,now(),'owner_attestation')`,
  [memberLink, f.tenantId, f.receptionistId, f.memberId, f.userId]);
  const scoped = await mintSelfServiceSession({
    tenantId: f.tenantId, userId: f.receptionistId, audience: "member",
    subjectId: f.memberId, linkIds: [memberLink], accountPhone: person.phone,
  });
  memberToken = scoped.cookieValue;
  await f.admin.query(`insert into roles (id,tenant_id,key,name,home_path,home_ordinal)
    values($1,$3,'receptionist','Reception','/reception',3),($2,$3,'coach','Coach','/coach',4)`,
  [sameRole, anotherRole, f.otherTenant]);
  await f.admin.query(`insert into tenant_memberships (id,tenant_id,user_id,role_id,status)
    values($1,$2,$3,$4,'active')`, [anotherMembership, f.otherTenant, f.receptionistId, sameRole]);
});

afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from self_service_session_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from self_service_sessions where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from member_account_links where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

beforeEach(() => {
  request.headers = new Headers({ cookie: `${staffCookie}; ${ACTIVE_CLUB_COOKIE}=${f.tenantId}` });
  request.selfToken = "";
  request.preferences.clear();
  request.set.mockClear();
  request.delete.mockClear();
});

it("offers a verified member role with PIN confirmation and keeps same-role business switching separate", async () => {
  const result = await readStaffWorkspaceRoles(f.context(f.receptionistId, "receptionist"));
  expect(result).toEqual({
    current: "Reception", showBusinessSwitch: true,
    choices: [{ label: "Member", href: `/member/sign-in?clubId=${f.tenantId}`, detail: "Confirm with your PIN" }],
  });
});

it("uses an existing role session only for the same verified account and business", async () => {
  request.selfToken = memberToken;
  const staff = await readStaffWorkspaceRoles(f.context(f.receptionistId, "receptionist"));
  expect(staff?.choices).toEqual([{ label: "Member", href: "/member", detail: "Open your workspace" }]);
  const member = await resolveScopedSelfScope("member");
  expect(member).not.toBeNull();
  const options = await readSelfWorkspaceRoles(member!);
  expect(options?.choices).toEqual([{ label: "Reception", href: "/reception", detail: "Open your staff workspace" }]);
  request.headers = new Headers();
  expect((await readSelfWorkspaceRoles(member!))?.choices).toEqual([
    { label: "Reception", href: `/login?clubId=${f.tenantId}&role=receptionist`, detail: "Confirm with your PIN" },
  ]);
});

it("opens the explicitly chosen business after PIN confirmation ahead of a remembered business", async () => {
  request.headers = new Headers({ cookie: staffCookie });
  request.preferences.set(lastBusinessKey(betterAuthId), f.otherTenant);
  await expect(homeForSessionAction({ clubId: f.tenantId, role: "receptionist" })).resolves.toEqual({
    kind: "ok", path: "/reception",
  });
  expect(request.set).toHaveBeenCalledWith(ACTIVE_CLUB_COOKIE, f.tenantId, expect.anything());
  request.set.mockClear();
  await homeForSessionAction();
  expect(request.set).toHaveBeenCalledWith(ACTIVE_CLUB_COOKIE, f.otherTenant, expect.anything());
});

it("returns to business selection when the chosen staff role is no longer live", async () => {
  request.headers = new Headers({ cookie: staffCookie });
  request.preferences.set(lastBusinessKey(betterAuthId), f.tenantId);
  await f.admin.query("update tenant_memberships set status='revoked' where tenant_id=$1 and user_id=$2", [f.otherTenant, f.receptionistId]);
  try {
    await expect(homeForSessionAction({ clubId: f.otherTenant, role: "receptionist" })).resolves.toEqual({
      kind: "ok", path: "/clubs?unavailable=1",
    });
    expect(request.set).not.toHaveBeenCalledWith(ACTIVE_CLUB_COOKIE, expect.anything(), expect.anything());
  } finally {
    await f.admin.query("update tenant_memberships set status='active' where id=$1", [anotherMembership]);
  }
});

it("withholds a revoked or unrelated linked role while offering the other assigned staff role", async () => {
  await f.admin.query(`update member_account_links
    set status='revoked', revoked_at=now(), revoked_by_user_id=$2 where id=$1`,
  [memberLink, f.userId]);
  await f.admin.query("update tenant_memberships set role_id=$1 where id=$2", [anotherRole, anotherMembership]);
  const result = await readStaffWorkspaceRoles(f.context(f.receptionistId, "receptionist"));
  expect(result?.choices.map(choice => choice.href)).toEqual(["/clubs"]);
  expect(result?.showBusinessSwitch).toBe(false);
});
