// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";

const password = "security-fixture-password-only";
let email: string;
let userId: string;
let ip: string;
let sequence = 0;
type Auth = typeof import("@/db/platform-auth");
let auth: Auth;
beforeEach(async () => {
  userId = randomUUID(); email = `security-${userId}@example.test`;
  ip = `192.0.2.${++sequence}`;
  vi.resetModules();
  vi.stubEnv("OPS_EMAIL", email);
  vi.stubEnv("OPS_PASSWORD", password);
  await admin.query("insert into platform_users(id,email,name,password_hash,password_salt,totp_secret,totp_enrolled) values($1,$2,'Security fixture','unused','unused','JBSWY3DPEHPK3PXP',true)", [userId, email]);
  auth = await import("@/db/platform-auth");
});
afterEach(async () => {
  await admin.query("drop trigger if exists security_login_audit_fault on platform_audit_log");
  await admin.query("drop function if exists security_login_audit_fault()");
  await admin.query("delete from platform_audit_log where actor_id=$1 or ip_address=$2::inet", [userId, ip]);
  await admin.query("delete from platform_sessions where user_id=$1", [userId]);
  await admin.query("delete from platform_users where id=$1", [userId]);
  const { pool } = await import("@/db/client");
  await pool.end();
  vi.unstubAllEnvs();
});
afterAll(async () => admin.end());

const wrong = () => auth.platformLogin({ email, password: "wrong-password" }, { ipAddress: ip });
async function failFive() {
  for (let i = 0; i < 5; i++) await expect(wrong()).rejects.toMatchObject({ code: "invalid_credentials" });
}

describe("Ops login protection across processes", () => {
  it("audits failed known and unknown accounts without storing credentials or raw account identifiers", async () => {
    await expect(wrong()).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(auth.platformLogin({ email: "unknown@example.test", password }, { ipAddress: ip })).rejects.toMatchObject({ code: "invalid_credentials" });
    const rows = (await admin.query("select * from platform_audit_log where action='platform.login.failed' and ip_address=$1::inet", [ip])).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.detail.identityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(password);
    expect(JSON.stringify(rows)).not.toContain("wrong-password");
    expect(JSON.stringify(rows)).not.toContain(email);
    expect(JSON.stringify(rows)).not.toContain("unknown@example.test");
  });

  it("blocks even a correct password after five failures, including mixed email case", async () => {
    for (let i = 0; i < 5; i++) await expect(auth.platformLogin({ email: i % 2 ? email.toUpperCase() : email, password: "wrong" }, { ipAddress: ip })).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(auth.platformLogin({ email, password }, { ipAddress: ip })).rejects.toMatchObject({ code: "rate_limited" });
    expect((await admin.query("select 1 from platform_sessions where user_id=$1", [userId])).rows).toHaveLength(0);
    expect((await admin.query("select 1 from platform_audit_log where action='platform.login.throttled' and ip_address=$1::inet", [ip])).rows).toHaveLength(1);
  });

  it("serializes concurrent attempts instead of letting all requests pass the counter", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, wrong));
    expect(outcomes.filter(x => x.status === "rejected" && x.reason.code === "invalid_credentials")).toHaveLength(5);
    expect(outcomes.filter(x => x.status === "rejected" && x.reason.code === "rate_limited")).toHaveLength(5);
  });

  it("also limits password spraying from one address across different identities", async () => {
    for (let i = 0; i < 20; i++) await expect(auth.platformLogin({ email: `unknown-${i}@example.test`, password: "wrong" }, { ipAddress: ip })).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(auth.platformLogin({ email, password }, { ipAddress: ip })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("keeps the lock through a new module/pool and recovers after the window expires", async () => {
    await failFive();
    const { pool } = await import("@/db/client"); await pool.end();
    vi.resetModules(); auth = await import("@/db/platform-auth");
    await expect(auth.platformLogin({ email, password }, { ipAddress: ip })).rejects.toMatchObject({ code: "rate_limited" });
    await admin.query("update platform_audit_log set created_at=now()-interval '16 minutes' where ip_address=$1::inet", [ip]);
    await expect(auth.platformLogin({ email, password }, { ipAddress: ip })).resolves.toHaveProperty("sessionToken");
  });

  it("uses an account limit even when a proxy address is unavailable", async () => {
    for (let i = 0; i < 5; i++) await expect(auth.platformLogin({ email, password: "wrong" })).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(auth.platformLogin({ email, password })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("does not leave a usable session when successful-login audit fails", async () => {
    await admin.query(`create function security_login_audit_fault() returns trigger language plpgsql as $$ begin
      if new.actor_id='${userId}'::uuid then raise exception 'security login audit fixture failure'; end if;
      return new; end $$`);
    await admin.query("create trigger security_login_audit_fault before insert on platform_audit_log for each row execute function security_login_audit_fault()");
    await expect(auth.platformLogin({ email, password }, { ipAddress: ip })).rejects.toThrow();
    expect((await admin.query("select 1 from platform_sessions where user_id=$1", [userId])).rows).toHaveLength(0);
  });
});
