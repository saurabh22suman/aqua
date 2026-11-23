import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { sha256 } from "@/db/platform-auth-crypto";

const capture = vi.hoisted(() => ({ body: "", cookie: "", staffCookie: "", refuseMint: false, verifiedGate: null as null | (() => Promise<void>) }));
vi.mock("@/lib/messaging/provider", () => ({ getMessageProvider: () => ({
  send: async (message: { body: string }) => { capture.body = message.body; return { ok: true }; },
}) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === "aqua_self_session" && capture.cookie ? { value: capture.cookie } : undefined }),
  headers: async () => new Headers(capture.staffCookie ? { cookie: capture.staffCookie } : {}),
}));
vi.mock("@/lib/services/self-service-session", async (original) => {
  const actual = await original<typeof import("@/lib/services/self-service-session")>();
  return { ...actual, mintSelfServiceSessionInTx: async (...args: Parameters<typeof actual.mintSelfServiceSessionInTx>) => {
    const session = await actual.mintSelfServiceSessionInTx(...args);
    if (capture.refuseMint) throw new actual.SelfServiceAuthorizationError("link_not_live");
    return session;
  } };
});
vi.mock("@/db/pin-login", async (original) => {
  const actual = await original<typeof import("@/db/pin-login")>();
  return { ...actual, verifyPinCredentialInTx: async (...args: Parameters<typeof actual.verifyPinCredentialInTx>) => {
    const verified = await actual.verifyPinCredentialInTx(...args);
    if (verified && capture.verifiedGate) await capture.verifiedGate();
    return verified;
  } };
});

import { issueWhatsAppChallenge } from "@/db/whatsapp-auth";
import { saveResetPin, verifyPinResetCode } from "@/db/whatsapp-auth-complete";
import { CREDENTIAL_ISSUER, ensureBaUserForPhone, pinLogin, setCredential } from "@/lib/services/credentials";
import { issueOwnerResetLink } from "@/lib/services/invite-link-issue";
import { redeemLoginLink } from "@/lib/services/invite-link";
import { verifyInviteLinkToken } from "@/lib/services/invite-link-token";
import { redeemStaffLinkInTx } from "@/db/staff-link-redemption";
import { auth } from "@/lib/auth/server";
import { mintSelfServiceSession, resolveSelfServiceSession } from "@/lib/services/self-service-session";
import { POST as selfPinLogin } from "@/app/api/self/login/pin/route";
import { resolveSelfScope } from "@/lib/auth/self-scope";

let f: Awaited<ReturnType<typeof fixture>>;
let phone: string;
let cookie: string;
let sessionId: string;
let challenge: string | undefined;

beforeEach(async () => {
  f = await fixture();
  phone = (await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.userId])).rows[0]!.phone;
  const baId = await ensureBaUserForPhone(phone);
  await setCredential(baId, "123456");
  expect((await pinLogin(phone, "123456")).status).toBe(200);
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'members.link.confirm')", [f.tenantId, f.roleId]);
  const link = randomUUID();
  await f.admin.query("insert into member_account_links(id,tenant_id,user_id,member_id,status,verification_method,verified_by_user_id,account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis) values($1,$2,$3,$4,'active','club_record',$3,$3,now(),'owner_attestation')", [link, f.tenantId, f.userId, f.memberId]);
  const minted = await mintSelfServiceSession({ tenantId: f.tenantId, userId: f.userId, audience: "member", subjectId: f.memberId, linkIds: [link], accountPhone: phone });
  cookie = minted.cookieValue;
  sessionId = minted.sessionId;
});

afterEach(async () => {
  capture.refuseMint = false;
  capture.verifiedGate = null;
  capture.cookie = "";
  capture.staffCookie = "";
  if (!f) return;
  if (challenge) await f.admin.query("delete from whatsapp_auth_challenges where token_hash=$1", [sha256(challenge)]);
  challenge = undefined;
  await f.admin.query("delete from self_service_session_links where tenant_id=any($1::uuid[])", [[f.tenantId, f.otherTenant]]);
  await f.admin.query("delete from self_service_sessions where tenant_id=any($1::uuid[])", [[f.tenantId, f.otherTenant]]);
  await f.admin.query("delete from guardian_child_links where tenant_id=any($1::uuid[])", [[f.tenantId, f.otherTenant]]);
  await f.admin.query("delete from guardianships where tenant_id=any($1::uuid[])", [[f.tenantId, f.otherTenant]]);
  await f.admin.query("delete from member_account_links where tenant_id=any($1::uuid[])", [[f.tenantId, f.otherTenant]]);
  await f.admin.query("delete from invite_link_uses where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

async function issueVerifiedChallenge() {
  challenge = await issueWhatsAppChallenge(phone, "pin_reset");
  const code = capture.body.match(/\b\d{6}\b/)?.[0];
  expect(code).toBeDefined();
  expect((await verifyPinResetCode(challenge, code!)).ok).toBe(true);
  return challenge;
}

async function waitForChallengeLock(token: string): Promise<boolean> {
  for (let i = 0; i < 200; i++) {
    try {
      await f.admin.query("select token_hash from whatsapp_auth_challenges where token_hash=$1 for update nowait", [sha256(token)]);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "55P03") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

async function waitForBlockedBy(pid: number): Promise<boolean> {
  for (let i = 0; i < 200; i++) {
    const result = await f.admin.query<{ blocked: boolean }>(
      "select exists(select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as blocked", [pid],
    );
    if (result.rows[0]!.blocked) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

async function mintAcrossBothClubs(): Promise<string[]> {
  const otherPerson = randomUUID(), otherMember = randomUUID(), otherLocation = randomUUID();
  const otherLink = randomUUID();
  await f.admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Other',true)", [otherLocation, f.otherTenant]);
  await f.admin.query("insert into persons(id,tenant_id,full_name,phone) values($1,$2,'Other member',$3)", [otherPerson, f.otherTenant, phone]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values($1,$2,$3,$4,'active','OTHER')", [otherMember, f.otherTenant, otherPerson, otherLocation]);
  await f.admin.query("insert into member_account_links(id,tenant_id,user_id,member_id,status,verification_method,verified_by_user_id,verified_phone,verified_phone_verified_at) values($1,$2,$3,$4,'active','club_record',$3,$5,now())", [otherLink, f.otherTenant, f.userId, otherMember, phone]);
  const otherMemberCookie = (await mintSelfServiceSession({ tenantId: f.otherTenant, userId: f.userId, audience: "member", subjectId: otherMember, linkIds: [otherLink], accountPhone: phone })).cookieValue;
  const result = [cookie, otherMemberCookie];
  for (const [tenantId, personId, memberId] of [[f.tenantId, f.personId, f.memberId], [f.otherTenant, otherPerson, otherMember]] as const) {
    const guardian = randomUUID(), relationship = randomUUID(), link = randomUUID();
    await f.admin.query("insert into persons(id,tenant_id,full_name,phone) values($1,$2,'Guardian',$3)", [guardian, tenantId, phone]);
    await f.admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship,is_primary) values($1,$2,$3,$4,'parent',true)", [relationship, tenantId, personId, guardian]);
    await f.admin.query("insert into guardian_child_links(id,tenant_id,user_id,guardianship_id,member_id,status,verification_method,verified_by_user_id,verified_phone,verified_phone_verified_at) values($1,$2,$3,$4,$5,'active','club_record',$3,$6,now())", [link, tenantId, f.userId, relationship, memberId, phone]);
    result.push((await mintSelfServiceSession({ tenantId, userId: f.userId, audience: "guardian", subjectId: null, linkIds: [link], accountPhone: phone })).cookieValue);
  }
  return result;
}

for (const door of ["whatsapp", "owner"] as const) {
  it(`${door} rotation revokes Member and Family cookies across two clubs`, async () => {
    const cookies = await mintAcrossBothClubs();
    for (const value of cookies) expect((await resolveSelfServiceSession({ cookieValue: value, accountPhone: phone })).ok).toBe(true);
    if (door === "whatsapp") {
      expect(await saveResetPin(await issueVerifiedChallenge(), "654321")).toBe(true);
    } else {
      const issued = await issueOwnerResetLink(f.tenantId, f.membershipId);
      if (issued.kind !== "ok") throw new Error("reset issue failed");
      expect((await redeemLoginLink(issued.token, { pin: "654321" })).kind).toBe("ok");
    }
    for (const value of cookies) expect((await resolveSelfServiceSession({ cookieValue: value, accountPhone: phone })).ok).toBe(false);
    expect((await pinLogin(phone, "654321")).status).toBe(200);
    const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
    for (const tenantId of [f.tenantId, f.otherTenant]) {
      for (const audience of ["member", "guardian"] as const) {
        const response = await selfPinLogin(new Request(`${origin}/api/self/login/pin`, {
          method: "POST", headers: { "content-type": "application/json", origin, host: new URL(origin).host },
          body: JSON.stringify({ phone, pin: "654321", clubId: tenantId, audience }),
        }));
        expect(response.status).toBe(200);
        const fresh = response.headers.get("set-cookie")?.match(/aqua_self_session=([^;]+)/)?.[1];
        expect(fresh).toBeDefined();
        expect((await resolveSelfServiceSession({ cookieValue: fresh, accountPhone: phone, expectedAudience: audience })).ok).toBe(true);
      }
    }
  });
}

it("accepts an epoch-zero session and rejects an attempt to rewrite its epoch", async () => {
  const row = await f.admin.query<{ credential_epoch: string }>("select credential_epoch from self_service_sessions where id=$1", [sessionId]);
  expect(row.rows[0]!.credential_epoch).toBe("0");
  expect((await resolveSelfServiceSession({ cookieValue: cookie, accountPhone: phone })).ok).toBe(true);
  await expect(f.admin.query("update self_service_sessions set credential_epoch=1 where id=$1", [sessionId])).rejects.toThrow();
});

it("revokes an old cookie on owner reset with a PIN and accepts the new credential", async () => {
  const issued = await issueOwnerResetLink(f.tenantId, f.membershipId);
  expect(issued.kind).toBe("ok");
  if (issued.kind !== "ok") throw new Error("reset issue failed");
  expect((await redeemLoginLink(issued.token, { pin: "654321" })).kind).toBe("ok");
  expect((await resolveSelfServiceSession({ cookieValue: cookie, accountPhone: phone })).ok).toBe(false);
  expect((await pinLogin(phone, "654321")).status).toBe(200);
  expect((await f.admin.query<{ credential_epoch: string }>("select credential_epoch from users where id=$1", [f.userId])).rows[0]!.credential_epoch).toBe("1");
});

it("keeps scoped sessions valid when an owner reset link supplies no new PIN", async () => {
  const issued = await issueOwnerResetLink(f.tenantId, f.membershipId);
  if (issued.kind !== "ok") throw new Error("reset issue failed");
  expect((await redeemLoginLink(issued.token)).kind).toBe("ok");
  expect((await resolveSelfServiceSession({ cookieValue: cookie, accountPhone: phone })).ok).toBe(true);
  expect((await f.admin.query<{ credential_epoch: string }>("select credential_epoch from users where id=$1", [f.userId])).rows[0]!.credential_epoch).toBe("0");
});

it("rolls back owner credential rotation, epoch, JTI and sessions when staff mint fails", async () => {
  const issued = await issueOwnerResetLink(f.tenantId, f.membershipId);
  if (issued.kind !== "ok") throw new Error("reset issue failed");
  const claims = verifyInviteLinkToken(issued.token);
  if (!claims) throw new Error("invalid fixture token");
  const pinHash = await (await auth.$context).password.hash("654321");
  const before = await f.admin.query("select id from ba_session where user_id=(select better_auth_id from users where id=$1)", [f.userId]);
  await expect(redeemStaffLinkInTx({ claims, pinHash, issuer: CREDENTIAL_ISSUER, mintSession: async () => { throw new Error("synthetic mint failure"); } })).rejects.toThrow();
  expect((await f.admin.query("select credential_epoch from users where id=$1", [f.userId])).rows[0].credential_epoch).toBe("0");
  expect((await f.admin.query("select jti from invite_link_uses where jti=$1", [claims.jti])).rowCount).toBe(0);
  expect((await f.admin.query("select id from ba_session where user_id=(select better_auth_id from users where id=$1)", [f.userId])).rowCount).toBe(before.rowCount);
  expect((await resolveSelfServiceSession({ cookieValue: cookie, accountPhone: phone })).ok).toBe(true);
  expect((await pinLogin(phone, "123456")).status).toBe(200);
});

it("retries a deadlocked owner redemption without double-incrementing the epoch", async () => {
  const issued = await issueOwnerResetLink(f.tenantId, f.membershipId);
  if (issued.kind !== "ok") throw new Error("reset issue failed");
  const claims = verifyInviteLinkToken(issued.token);
  if (!claims) throw new Error("invalid fixture token");
  const pinHash = await (await auth.$context).password.hash("654321");
  let attempts = 0;
  const result = await redeemStaffLinkInTx({ claims, pinHash, issuer: CREDENTIAL_ISSUER, mintSession: async () => {
    if (++attempts === 1) throw Object.assign(new Error("synthetic deadlock"), { code: "40P01" });
    return "synthetic-session-token";
  } });
  expect(result.kind).toBe("ok");
  expect(attempts).toBe(2);
  expect((await f.admin.query("select credential_epoch from users where id=$1", [f.userId])).rows[0].credential_epoch).toBe("1");
  expect((await f.admin.query("select jti from invite_link_uses where jti=$1", [claims.jti])).rowCount).toBe(1);
  expect((await resolveSelfServiceSession({ cookieValue: cookie, accountPhone: phone })).ok).toBe(false);
});

it("does not rotate or consume an expired WhatsApp reset", async () => {
  const token = await issueVerifiedChallenge();
  await f.admin.query("update whatsapp_auth_challenges set expires_at=now()-interval '1 second' where token_hash=$1", [sha256(token)]);
  expect(await saveResetPin(token, "654321")).toBe(false);
  expect((await resolveSelfServiceSession({ cookieValue: cookie, accountPhone: phone })).ok).toBe(true);
  expect((await f.admin.query<{ credential_epoch: string }>("select credential_epoch from users where id=$1", [f.userId])).rows[0]!.credential_epoch).toBe("0");
  expect((await f.admin.query("select consumed_at from whatsapp_auth_challenges where token_hash=$1", [sha256(token)])).rows[0].consumed_at).toBeNull();
});

it("rolls back credential and epoch writes if a verified challenge expires while waiting", async () => {
  const token = await issueVerifiedChallenge();
  await f.admin.query("update whatsapp_auth_challenges set expires_at=now()+interval '2 seconds' where token_hash=$1", [sha256(token)]);
  const blocker = await f.admin.connect();
  let reset: Promise<boolean> | undefined;
  try {
    await blocker.query("begin");
    await blocker.query("select id from users where id=$1 for update", [f.userId]);
    reset = saveResetPin(token, "654321");
    expect(await waitForChallengeLock(token)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await blocker.query("commit");
    expect(await reset).toBe(false);
    expect((await f.admin.query("select credential_epoch from users where id=$1", [f.userId])).rows[0].credential_epoch).toBe("0");
    expect((await f.admin.query("select consumed_at from whatsapp_auth_challenges where token_hash=$1", [sha256(token)])).rows[0].consumed_at).toBeNull();
    expect((await pinLogin(phone, "123456")).status).toBe(200);
    expect((await resolveSelfServiceSession({ cookieValue: cookie, accountPhone: phone })).ok).toBe(true);
  } finally {
    await blocker.query("rollback").catch(() => undefined);
    blocker.release();
    await reset?.catch(() => undefined);
  }
}, 20000);

it("does not fall back to staff authority for a stale scoped cookie", async () => {
  expect(await saveResetPin(await issueVerifiedChallenge(), "654321")).toBe(true);
  const staffLogin = await pinLogin(phone, "654321");
  expect(staffLogin.status).toBe(200);
  const staffCookie = staffLogin.headers.get("set-cookie")?.split(";")[0];
  expect(staffCookie).toBeDefined();
  capture.staffCookie = staffCookie!;
  expect((await resolveSelfScope("member", null))?.scope.kind).toBe("staff_session");
  capture.cookie = cookie;
  const resolver = await resolveSelfScope("member", null);
  expect(resolver?.scope.kind).toBe("self_session");
  const read = vi.fn(async () => "private");
  await expect(resolver!.read(read)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

it("records a wrong PIN and clears the counter on an atomic successful self login", async () => {
  const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
  const login = (pin: string) => selfPinLogin(new Request(`${origin}/api/self/login/pin`, {
    method: "POST", headers: { "content-type": "application/json", origin, host: new URL(origin).host },
    body: JSON.stringify({ phone, pin, clubId: f.tenantId, audience: "member" }),
  }));
  const beforeSessions = (await f.admin.query("select id from ba_session where user_id=(select better_auth_id from users where id=$1)", [f.userId])).rowCount;
  expect((await login("000000")).status).toBe(401);
  expect((await f.admin.query("select failed_pin_attempts from users where id=$1", [f.userId])).rows[0].failed_pin_attempts).toBe(1);
  const response = await login("123456");
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("aqua_self_session=");
  expect((await f.admin.query("select failed_pin_attempts from users where id=$1", [f.userId])).rows[0].failed_pin_attempts).toBe(0);
  expect((await f.admin.query("select id from ba_session where user_id=(select better_auth_id from users where id=$1)", [f.userId])).rowCount).toBe(beforeSessions);
});

it("clears prior PIN failures when a correct PIN is followed by mint refusal", async () => {
  const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
  const login = (pin: string) => selfPinLogin(new Request(`${origin}/api/self/login/pin`, {
    method: "POST", headers: { "content-type": "application/json", origin, host: new URL(origin).host },
    body: JSON.stringify({ phone, pin, clubId: f.tenantId, audience: "member" }),
  }));
  expect((await login("000000")).status).toBe(401);
  const before = await f.admin.query("select id,revoked_at from self_service_sessions where tenant_id=$1", [f.tenantId]);
  capture.refuseMint = true;
  expect((await login("123456")).status).toBe(401);
  expect((await f.admin.query("select failed_pin_attempts from users where id=$1", [f.userId])).rows[0].failed_pin_attempts).toBe(0);
  expect((await f.admin.query("select id,revoked_at from self_service_sessions where tenant_id=$1", [f.tenantId])).rows).toEqual(before.rows);
});

it("serializes a verified old PIN and mint before a concurrent reset", async () => {
  const token = await issueVerifiedChallenge();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  capture.verifiedGate = async () => { enter(); await released; };
  const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
  const login = selfPinLogin(new Request(`${origin}/api/self/login/pin`, {
    method: "POST", headers: { "content-type": "application/json", origin, host: new URL(origin).host },
    body: JSON.stringify({ phone, pin: "123456", clubId: f.tenantId, audience: "member" }),
  }));
  try {
    await entered;
    const reset = saveResetPin(token, "654321");
    release();
    const response = await login;
    expect(response.status).toBe(200);
    const mintedCookie = response.headers.get("set-cookie")?.match(/aqua_self_session=([^;]+)/)?.[1];
    expect(mintedCookie).toBeDefined();
    expect(await reset).toBe(true);
    expect((await resolveSelfServiceSession({ cookieValue: mintedCookie, accountPhone: phone })).ok).toBe(false);
  } finally {
    release();
    capture.verifiedGate = null;
  }
}, 20000);

it("refuses an old-PIN login queued behind a reset", async () => {
  const token = await issueVerifiedChallenge();
  const blocker = await f.admin.connect();
  let reset: Promise<boolean> | undefined;
  try {
    await blocker.query("begin");
    await blocker.query("select id from users where id=$1 for update", [f.userId]);
    const pid = (await blocker.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    reset = saveResetPin(token, "654321");
    // The reset locks its challenge before waiting on the held account row.
    expect(await waitForChallengeLock(token)).toBe(true);
    expect(await waitForBlockedBy(pid)).toBe(true);
    const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
    const login = selfPinLogin(new Request(`${origin}/api/self/login/pin`, {
      method: "POST", headers: { "content-type": "application/json", origin, host: new URL(origin).host },
      body: JSON.stringify({ phone, pin: "123456", clubId: f.tenantId, audience: "member" }),
    }));
    await blocker.query("commit");
    expect(await reset).toBe(true);
    expect((await login).status).toBe(401);
    expect((await resolveSelfServiceSession({ cookieValue: cookie, accountPhone: phone })).ok).toBe(false);
  } finally {
    await blocker.query("rollback").catch(() => undefined);
    blocker.release();
    await reset?.catch(() => undefined);
  }
}, 20000);
