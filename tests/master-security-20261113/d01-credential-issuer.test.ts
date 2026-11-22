import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { hasCredentialByBaUserId, setCredential, verifyCredentialPin } from "@/lib/services/credentials";

let f: Awaited<ReturnType<typeof fixture>>;
const baId = randomUUID(), otherId = randomUUID(), readId = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into ba_user(id,name,email) values($1,'Synthetic',$2),($3,'Synthetic other',$4)", [baId, `${baId}@example.invalid`, otherId, `${otherId}@example.invalid`]);
  await f.admin.query("insert into ba_user(id,name,email) values($1,'Synthetic read',$2)", [readId, `${readId}@example.invalid`]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from ba_account where user_id=any($1::text[])", [[baId, otherId, readId]]);
  await f.admin.query("delete from ba_user where id=any($1::text[])", [[baId, otherId, readId]]);
  await f.cleanup();
});

it("does not report or verify an issuer-mismatched credential as the local PIN", async () => {
  await setCredential(readId, "123456");
  await f.admin.query("update ba_account set issuer='other:issuer' where user_id=$1", [readId]);
  expect(await hasCredentialByBaUserId(readId)).toBe(false);
  expect(await verifyCredentialPin(readId, "123456")).toBe(false);
  await f.admin.query("update ba_account set issuer='local:credential',account_id=$1 where user_id=$2", [`other-${readId}`, readId]);
  expect(await hasCredentialByBaUserId(readId)).toBe(false);
  expect(await verifyCredentialPin(readId, "123456")).toBe(false);
});

it("writes and resets only the canonical local credential", async () => {
  await setCredential(baId, "123456");
  await setCredential(baId, "654321");
  const rows = await f.admin.query("select user_id,provider_id,account_id,issuer from ba_account where user_id=$1", [baId]);
  expect(rows.rows).toEqual([{ user_id: baId, provider_id: "credential", account_id: baId, issuer: "local:credential" }]);
});

it("never overwrites or retags a conflicting noncanonical credential", async () => {
  await f.admin.query("insert into ba_account(id,user_id,provider_id,account_id,issuer,password) values($1,$2,'credential',$2,'other:issuer','sentinel')", [randomUUID(), otherId]);
  await expect(setCredential(otherId, "123456")).rejects.toThrow();
  const rows = await f.admin.query("select issuer,password from ba_account where user_id=$1", [otherId]);
  expect(rows.rows).toEqual([{ issuer: "other:issuer", password: "sentinel" }]);
});
