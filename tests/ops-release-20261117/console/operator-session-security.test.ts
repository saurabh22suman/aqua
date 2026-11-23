import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { provisionPlatformUser } from "@/db/platform-auth";
import { sha256 } from "@/db/platform-auth-crypto";
import { currentOperatorSessionId } from "@/db/platform-operators-read";

let actor = "";
let other = "";
const token = randomBytes(32).toString("hex");
const expired = randomBytes(32).toString("hex");
const unverified = randomBytes(32).toString("hex");
const id = randomUUID();
beforeAll(async () => {
  const tag = randomUUID();
  actor = (await provisionPlatformUser({ email: `${tag}@example.test`, name: "Fixture", password: `Fixture-${tag}`, role: "admin" })).id;
  other = (await provisionPlatformUser({ email: `other-${tag}@example.test`, name: "Other", password: `Fixture-${tag}`, role: "viewer" })).id;
  for (const [sessionId, value, factor, expires] of [[id, token, true, new Date(Date.now() + 60000)], [randomUUID(), expired, true, new Date(Date.now() - 60000)], [randomUUID(), unverified, false, new Date(Date.now() + 60000)]] as const) {
    await admin.query("insert into platform_sessions (id,user_id,token_hash,second_factor_passed,expires_at) values ($1,$2,$3,$4,$5)", [sessionId, actor, sha256(value), factor, expires]);
  }
});
afterAll(async () => {
  if (actor) await admin.query("delete from platform_sessions where user_id = $1", [actor]);
  if (actor && other) await admin.query("delete from platform_users where id = any($1::uuid[])", [[actor, other]]);
});
it("resolves only a verified live session of the active actor", async () => {
  expect(await currentOperatorSessionId(token, actor)).toBe(id);
  expect(await currentOperatorSessionId(token, other)).toBeNull();
  expect(await currentOperatorSessionId(expired, actor)).toBeNull();
  expect(await currentOperatorSessionId(unverified, actor)).toBeNull();
  expect(await currentOperatorSessionId("unknown", actor)).toBeNull();
  expect(await currentOperatorSessionId("", actor)).toBeNull();
  await admin.query("update platform_users set status = 'suspended' where id = $1", [actor]);
  expect(await currentOperatorSessionId(token, actor)).toBeNull();
});
