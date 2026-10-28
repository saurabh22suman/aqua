// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
import { prepareOperatorTotp, confirmOperatorTotp } from "@/scripts/enrol-ops-authenticator";
import { currentTotpCode, verifyTotp } from "@/db/platform-auth";

const id = randomUUID(), email = `enrol-${id}@example.test`;
beforeAll(async () => {
  await admin.query("insert into platform_users(id,email,name,password_hash,password_salt) values($1,$2,'Enrol fixture','preserve-hash','preserve-salt')", [id, email]);
});
afterAll(async () => {
  await admin.query("delete from platform_audit_log where target_id=$1", [id]);
  await admin.query("delete from platform_users where id=$1", [id]);
  await admin.end(); await (await import("@/db/client")).pool.end();
});
describe("Non-destructive terminal-only Ops authenticator enrolment", () => {
  it("prepares an existing operator without changing credentials or enabling MFA prematurely", async () => {
    const result = await prepareOperatorTotp(email);
    expect(result?.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(result?.uri).toContain("otpauth://totp/");
    const row = (await admin.query("select password_hash,password_salt,totp_enrolled,totp_secret from platform_users where id=$1", [id])).rows[0];
    expect(row).toMatchObject({ password_hash: "preserve-hash", password_salt: "preserve-salt", totp_enrolled: false });
    expect(row.totp_secret).toBe(result?.secret);
  });
  it("resumes preparation without rotating the key, requires a real proof and audits without secrets", async () => {
    const result = await prepareOperatorTotp(email);
    expect(result).not.toBeNull();
    if (!result) return;
    expect((await prepareOperatorTotp(email))?.secret).toBe(result.secret);
    const bad = ["000000", "111111", "222222"].find(code => !verifyTotp(result.secret, code))!;
    expect(await confirmOperatorTotp(email, bad)).toBe(false);
    expect((await admin.query("select totp_enrolled from platform_users where id=$1", [id])).rows[0].totp_enrolled).toBe(false);
    expect(await confirmOperatorTotp(email, currentTotpCode(result.secret))).toBe(true);
    expect((await admin.query("select password_hash,totp_enrolled from platform_users where id=$1", [id])).rows[0]).toMatchObject({ password_hash: "preserve-hash", totp_enrolled: true });
    const audit = (await admin.query("select * from platform_audit_log where target_id=$1", [id])).rows;
    expect(audit.some(row => row.action === "platform.mfa.enrolled")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(result.secret);
    expect(JSON.stringify(audit)).not.toContain(result.uri);
  });
  it("never resets an enrolled account, creates an unknown account, or enrolls a suspended operator", async () => {
    expect(await prepareOperatorTotp(email)).toBeNull();
    expect(await prepareOperatorTotp(`missing-${id}@example.test`)).toBeNull();
    await admin.query("update platform_users set status='suspended',totp_enrolled=false where id=$1", [id]);
    expect(await prepareOperatorTotp(email)).toBeNull();
    expect(await confirmOperatorTotp(email, "000000")).toBe(false);
  });
});
