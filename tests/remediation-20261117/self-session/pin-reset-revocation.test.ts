import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { sha256 } from "@/db/platform-auth-crypto";

const state = vi.hoisted(() => ({ body: "", token: "" }));
vi.mock("@/lib/messaging/provider", () => ({ getMessageProvider: () => ({ send: async (message: { body: string }) => { state.body = message.body; return { ok: true }; } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "aqua_self_session" ? { value: state.token } : undefined }), headers: async () => new Headers() }));
import { issueWhatsAppChallenge } from "@/db/whatsapp-auth";
import { saveResetPin, verifyPinResetCode } from "@/db/whatsapp-auth-complete";
import { ensureBaUserForPhone, pinLogin, setCredential } from "@/lib/services/credentials";
import { mintSelfServiceSession } from "@/lib/services/self-service-session";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";

let f: Awaited<ReturnType<typeof fixture>>, challenge: string;
beforeAll(async () => {
  f = await fixture();
  const { rows: [user] } = await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.userId]);
  const baId = await ensureBaUserForPhone(user.phone);
  await setCredential(baId, "123456");
  expect((await pinLogin(user.phone, "123456")).status).toBe(200);
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'members.link.confirm')", [f.tenantId, f.roleId]);
  const link = randomUUID();
  await f.admin.query("insert into member_account_links(id,tenant_id,user_id,member_id,status,verification_method,verified_by_user_id,account_binding_confirmed_by_user_id,account_binding_confirmed_at,account_binding_basis) values($1,$2,$3,$4,'active','club_record',$3,$3,now(),'owner_attestation')", [link, f.tenantId, f.userId, f.memberId]);
  state.token = (await mintSelfServiceSession({ tenantId: f.tenantId, userId: f.userId, audience: "member", subjectId: f.memberId, linkIds: [link], accountPhone: user.phone })).cookieValue;
  challenge = await issueWhatsAppChallenge(user.phone, "pin_reset");
  const code = state.body.match(/\b\d{6}\b/)?.[0];
  expect(code).toBeDefined();
  expect((await verifyPinResetCode(challenge, code!)).ok).toBe(true);
});
afterAll(async () => {
  if (!f) return;
  if (challenge) await f.admin.query("delete from whatsapp_auth_challenges where token_hash=$1", [sha256(challenge)]);
  await f.admin.query("delete from self_service_session_links where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from self_service_sessions where tenant_id=$1", [f.tenantId]);
  await f.admin.query("delete from member_account_links where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});
it("revokes a previously minted scoped cookie after WhatsApp PIN recovery", async () => {
  const resolver = await resolveScopedSelfScope("member");
  expect(resolver).not.toBeNull();
  await expect(resolver!.read(async () => "private")).resolves.toBe("private");
  expect(await saveResetPin(challenge, "654321")).toBe(true);
  const read = vi.fn(async () => "private");
  await expect(resolver!.read(read)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
