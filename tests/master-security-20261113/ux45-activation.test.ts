import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { activateSelfServiceAccount } from "@/lib/services/self-service-activation";
import { resolveSelfServiceSession } from "@/lib/services/self-service-session";
import { signSelfServiceToken } from "@/lib/services/self-service-token";

let f: Awaited<ReturnType<typeof fixture>>;
const userId = randomUUID(), guardian = randomUUID(), child2 = randomUUID(), member2 = randomUUID();
const links = [randomUUID(), randomUUID()];
const relations = [randomUUID(), randomUUID()];
const phone = `+91${String(BigInt('0x' + userId.replaceAll('-', '').slice(0, 12)) % 9000000000n + 1000000000n)}`;

beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into users(id,phone) values($1,$2)", [userId, phone]);
  await f.admin.query("insert into persons(id,tenant_id,full_name,phone) values($1,$3,'Synthetic guardian',$4),($2,$3,'Synthetic child two',null)", [guardian, child2, f.tenantId, phone]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values($1,$2,$3,$4,'active','CHILD2')", [member2, f.tenantId, child2, f.locationA]);
  await f.admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship,is_primary) values($1,$3,$4,$6,'parent',true),($2,$3,$5,$6,'parent',true)", [relations[0], relations[1], f.tenantId, f.personId, child2, guardian]);
  for (let i = 0; i < 2; i++) {
    await f.admin.query("insert into guardian_child_links(id,tenant_id,user_id,guardianship_id,member_id,status,verification_method,verified_by_user_id,verified_phone,verified_phone_verified_at) values($1,$2,$3,$4,$5,'invited','club_record',$6,$7,now())", [links[i], f.tenantId, userId, relations[i], i ? member2 : f.memberId, f.userId, phone]);
  }
});

afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from self_service_session_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from self_service_sessions where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from self_service_link_uses where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardian_child_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from guardianships where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("binds both active children immediately after the second invitation", async () => {
  const activate = async (linkId: string) => activateSelfServiceAccount({
    claims: signSelfServiceToken({ tenantId: f.tenantId, userId, audience: "guardian", subjectId: null, linkIds: [linkId] }).claims,
    pin: "123456",
  });
  const first = await activate(links[0]!);
  expect(first.kind).toBe("ok");
  if (first.kind !== "ok") return;
  const firstSession = await resolveSelfServiceSession({ cookieValue: first.cookieValue, accountPhone: phone, expectedAudience: "guardian" });
  expect(firstSession.ok).toBe(true);
  if (firstSession.ok) expect(firstSession.scope.linkIds).toEqual([links[0]]);
  const pending = await f.admin.query("select status from guardian_child_links where id=$1", [links[1]]);
  expect(pending.rows[0].status).toBe("invited");
  const second = await activate(links[1]!);
  expect(second.kind).toBe("ok");
  if (second.kind !== "ok") return;
  const session = await resolveSelfServiceSession({ cookieValue: second.cookieValue, accountPhone: phone, expectedAudience: "guardian" });
  expect(session.ok).toBe(true);
  if (session.ok) expect([...session.scope.linkIds].sort()).toEqual([...links].sort());
});

it("binds both children when invitations are activated in the reverse order", async () => {
  await f.admin.query("update guardian_child_links set status='invited',revoked_at=null,revoked_by_user_id=null where id=any($1::uuid[])", [links]);
  const activate = (linkId: string) => activateSelfServiceAccount({ claims: signSelfServiceToken({ tenantId: f.tenantId, userId, audience: "guardian", subjectId: null, linkIds: [linkId] }).claims, pin: "123456" });
  const first = await activate(links[1]!);
  expect(first.kind).toBe("ok");
  if (first.kind !== "ok") return;
  const firstSession = await resolveSelfServiceSession({ cookieValue: first.cookieValue, accountPhone: phone, expectedAudience: "guardian" });
  expect(firstSession.ok).toBe(true);
  if (firstSession.ok) expect(firstSession.scope.linkIds).toEqual([links[1]]);
  const second = await activate(links[0]!);
  expect(second.kind).toBe("ok");
  if (second.kind !== "ok") return;
  const session = await resolveSelfServiceSession({ cookieValue: second.cookieValue, accountPhone: phone, expectedAudience: "guardian" });
  expect(session.ok).toBe(true);
  if (session.ok) expect([...session.scope.linkIds].sort()).toEqual([...links].sort());
});

it("does not restore a revoked sibling when activating the remaining invitation", async () => {
  await f.admin.query("update guardian_child_links set status='revoked',revoked_at=now(),revoked_by_user_id=$1 where id=$2", [f.userId, links[0]]);
  await f.admin.query("update guardian_child_links set status='invited',revoked_at=null,revoked_by_user_id=null where id=$1", [links[1]]);
  const result = await activateSelfServiceAccount({ claims: signSelfServiceToken({ tenantId: f.tenantId, userId, audience: "guardian", subjectId: null, linkIds: [links[1]!] }).claims, pin: "123456" });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  const session = await resolveSelfServiceSession({ cookieValue: result.cookieValue, accountPhone: phone, expectedAudience: "guardian" });
  expect(session.ok).toBe(true);
  if (session.ok) expect(session.scope.linkIds).toEqual([links[1]]);
});

it("refuses a named link from a different tenant", async () => {
  const result = await activateSelfServiceAccount({ claims: signSelfServiceToken({ tenantId: f.otherTenant, userId, audience: "guardian", subjectId: null, linkIds: [links[1]!] }).claims, pin: "123456" });
  expect(result.kind).toBe("error");
  expect((await f.admin.query("select id from self_service_sessions where tenant_id=$1", [f.otherTenant])).rowCount).toBe(0);
});

it("refuses the revoked named invitation and an invitation whose recorded phone is no longer current", async () => {
  const activate = (linkId: string) => activateSelfServiceAccount({ claims: signSelfServiceToken({ tenantId: f.tenantId, userId, audience: "guardian", subjectId: null, linkIds: [linkId] }).claims, pin: "123456" });
  expect((await activate(links[0]!)).kind).toBe("error");
  await f.admin.query("update guardian_child_links set status='invited',verified_phone='+919876543210' where id=$1", [links[1]]);
  const before = await f.admin.query("select count(*)::int n from self_service_sessions where tenant_id=$1", [f.tenantId]);
  expect((await activate(links[1]!)).kind).toBe("error");
  const after = await f.admin.query("select count(*)::int n from self_service_sessions where tenant_id=$1", [f.tenantId]);
  expect(after.rows[0].n).toBe(before.rows[0].n);
});

it("omits a soft-deleted sibling when activating a separate valid invitation", async () => {
  await f.admin.query("update guardian_child_links set status='active',revoked_at=null,revoked_by_user_id=null,verified_phone=$2 where id=$1", [links[0], phone]);
  await f.admin.query("update guardian_child_links set status='invited',revoked_at=null,revoked_by_user_id=null,verified_phone=$2 where id=$1", [links[1], phone]);
  await f.admin.query("update persons set deleted_at=now() where id=$1", [f.personId]);
  try {
    const result = await activateSelfServiceAccount({ claims: signSelfServiceToken({ tenantId: f.tenantId, userId, audience: "guardian", subjectId: null, linkIds: [links[1]!] }).claims, pin: "123456" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const session = await resolveSelfServiceSession({ cookieValue: result.cookieValue, accountPhone: phone, expectedAudience: "guardian" });
    expect(session.ok).toBe(true);
    if (session.ok) expect(session.scope.linkIds).toEqual([links[1]]);
  } finally {
    await f.admin.query("update persons set deleted_at=null where id=$1", [f.personId]);
  }
});

it("does not mint a session when an active sibling's identity is unconfirmed", async () => {
  await f.admin.query("update guardian_child_links set status='active',revoked_at=null,revoked_by_user_id=null,verified_phone='+919876543210' where id=$1", [links[0]]);
  await f.admin.query("update guardian_child_links set status='invited',revoked_at=null,revoked_by_user_id=null,verified_phone=$2 where id=$1", [links[1], phone]);
  const before = await f.admin.query("select count(*)::int n from self_service_sessions where tenant_id=$1", [f.tenantId]);
  const result = await activateSelfServiceAccount({ claims: signSelfServiceToken({ tenantId: f.tenantId, userId, audience: "guardian", subjectId: null, linkIds: [links[1]!] }).claims, pin: "123456" });
  expect(result.kind).toBe("error");
  expect((await f.admin.query("select count(*)::int n from self_service_sessions where tenant_id=$1", [f.tenantId])).rows).toEqual(before.rows);
  expect((await f.admin.query("select status from guardian_child_links where id=$1", [links[1]])).rows[0].status).toBe("invited");
});
