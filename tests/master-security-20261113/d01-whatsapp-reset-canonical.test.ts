import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { sha256 } from "@/db/platform-auth-crypto";

const capture = vi.hoisted(() => ({ body: "" }));
vi.mock("@/lib/messaging/provider", () => ({ getMessageProvider: () => ({ send: async (message: { body: string }) => { capture.body = message.body; return { ok: true }; } }) }));
import { issueWhatsAppChallenge } from "@/db/whatsapp-auth";
import { saveResetPin, verifyPinResetCode } from "@/db/whatsapp-auth-complete";
import { ensureBaUserForPhone, pinLogin, setCredential, verifyCredentialPin } from "@/lib/services/credentials";

let f: Awaited<ReturnType<typeof fixture>>, baId: string, token: string;
beforeEach(async () => {
  f = await fixture();
  const { rows: [user] } = await f.admin.query<{ phone: string }>("select phone from users where id=$1", [f.userId]);
  baId = await ensureBaUserForPhone(user.phone);
  await setCredential(baId, "123456");
  expect((await pinLogin(user.phone, "123456")).status).toBe(200);
  capture.body = "";
  token = await issueWhatsAppChallenge(user.phone, "pin_reset");
  const code = capture.body.match(/\b\d{6}\b/)?.[0];
  expect(code).toBeDefined();
  expect((await verifyPinResetCode(token, code!)).ok).toBe(true);
});
afterEach(async () => {
  if (!f) return;
  await f.admin.query("delete from whatsapp_auth_challenges where token_hash=$1", [sha256(token)]);
  await f.cleanup();
});

it("creates the canonical account without overwriting a same-issuer noncanonical account", async () => {
  await f.admin.query("update ba_account set account_id=$1 where user_id=$2 and provider_id='credential'", [`other-${baId}`, baId]);
  const before = await f.admin.query("select id,password from ba_account where user_id=$1", [baId]);
  expect(await saveResetPin(token, "654321")).toBe(true);
  const after = await f.admin.query("select id,account_id,password from ba_account where user_id=$1 order by account_id", [baId]);
  expect(after.rows.find((row) => row.id === before.rows[0].id)?.password).toBe(before.rows[0].password);
  expect(after.rows.some((row) => row.account_id === baId)).toBe(true);
  expect(await verifyCredentialPin(baId, "654321")).toBe(true);
  expect((await f.admin.query("select id from ba_session where user_id=$1", [baId])).rowCount).toBe(0);
  expect(await saveResetPin(token, "111111")).toBe(false);
});

it("updates only the canonical account when another same-issuer account exists", async () => {
  const other = randomUUID();
  await f.admin.query("insert into ba_account(id,user_id,provider_id,account_id,issuer,password) values($1,$2,'credential',$3,'local:credential','foreign-hash')", [other, baId, `other-${baId}`]);
  expect(await saveResetPin(token, "654321")).toBe(true);
  const { rows: [row] } = await f.admin.query("select password from ba_account where id=$1", [other]);
  expect(row.password).toBe("foreign-hash");
  expect(await verifyCredentialPin(baId, "654321")).toBe(true);
});

it("rolls back a wrong-issuer canonical account collision without consuming reset or revoking sessions", async () => {
  await f.admin.query("update ba_account set issuer='foreign:issuer' where user_id=$1 and account_id=$1", [baId]);
  const before = await f.admin.query("select id,password,issuer from ba_account where user_id=$1", [baId]);
  const result = await saveResetPin(token, "654321").catch(() => false);
  expect(result).toBe(false);
  expect((await f.admin.query("select id,password,issuer from ba_account where user_id=$1", [baId])).rows).toEqual(before.rows);
  expect((await f.admin.query("select id from ba_session where user_id=$1", [baId])).rowCount).toBeGreaterThan(0);
  expect((await f.admin.query("select consumed_at from whatsapp_auth_challenges where token_hash=$1", [sha256(token)])).rows[0].consumed_at).toBeNull();
  expect((await f.admin.query("select id from platform_audit_log where action='credentials.pin_reset' and target_id=$1", [f.userId])).rowCount).toBe(0);
});
