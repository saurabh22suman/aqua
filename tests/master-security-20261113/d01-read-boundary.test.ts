import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { auth } from "@/lib/auth/server";
import { hasCredentialByBaUserId, verifyCredentialPin } from "@/lib/services/credentials";

let f: Awaited<ReturnType<typeof fixture>>;
const issuerId = randomUUID(), accountId = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into ba_user(id,name,email) values($1,'Synthetic issuer',$2),($3,'Synthetic account',$4)", [issuerId, `${issuerId}@example.invalid`, accountId, `${accountId}@example.invalid`]);
  const hash = await (await auth.$context).password.hash("123456");
  await f.admin.query("insert into ba_account(id,user_id,provider_id,account_id,issuer,password) values($1,$2,'credential',$2,'other:issuer',$3),($4,$5,'credential',$6,'local:credential',$3)", [randomUUID(), issuerId, hash, randomUUID(), accountId, `other-${accountId}`]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from ba_account where user_id=any($1::text[])", [[issuerId, accountId]]);
  await f.admin.query("delete from ba_user where id=any($1::text[])", [[issuerId, accountId]]);
  await f.cleanup();
});

it("does not report a wrong-issuer row as an existing local credential", async () => {
  expect(await hasCredentialByBaUserId(issuerId)).toBe(false);
});
it("does not verify a PIN against a wrong-issuer row", async () => {
  expect(await verifyCredentialPin(issuerId, "123456")).toBe(false);
});
it("does not report or verify a row with a different account ID", async () => {
  expect(await hasCredentialByBaUserId(accountId)).toBe(false);
  expect(await verifyCredentialPin(accountId, "123456")).toBe(false);
});
