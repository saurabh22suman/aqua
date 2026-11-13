import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { provisionPlatformUser, markTotpEnrolled } from "@/db/platform-auth";
import {
  loginPlatformAction, verifyPlatformTotpAction, logoutPlatformAction,
  platformAuthStatusAction, requireOpsAdminAction,
} from "@/lib/actions/platform-auth";
import {
  writePlatformSessionCookie, readPlatformSessionToken,
  clearPlatformSessionCookie, PLATFORM_COOKIE_NAME,
} from "@/lib/auth/platform-cookie";
import { POST } from "@/app/(platform)/ops/api/whatsapp-auth/route";
import type { MessageProvider } from "@/lib/messaging/provider";

// Only request transport and external delivery are mocked. Challenges,
// verification, sessions, audit and action authority use the real database.
const { cookieJar, send } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  send: vi.fn<MessageProvider["send"]>().mockResolvedValue({
    providerMessageId: "synthetic-ops-otp", status: "sent",
  }),
}));
vi.mock("@/lib/messaging/provider", () => ({
  getMessageProvider: () => ({ name: "mock", send }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { name, value } : undefined;
    },
    set: ({ name, value }: { name: string; value: string }) => {
      cookieJar.set(name, value);
    },
  }),
}));
class RedirectSignal extends Error {
  constructor(public path: string) { super(`REDIRECT:${path}`); }
}
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new RedirectSignal(path); },
}));

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const ids: string[] = [];
const phones: string[] = [];
let sequence = 0;

afterEach(() => { cookieJar.clear(); send.mockClear(); });
afterAll(async () => {
  await admin.query("delete from whatsapp_auth_challenges where phone=any($1::text[])", [phones]);
  await admin.query("delete from platform_sessions where user_id=any($1::uuid[])", [ids]);
  // Preserve platform audit and any referenced operator identity.
  await admin.query("delete from platform_users where id=any($1::uuid[]) and not exists (select 1 from platform_audit_log where actor_id=platform_users.id)", [ids]);
  await admin.end();
});

async function operator(role: "admin" | "viewer" = "admin") {
  const label = `${RUN}-${++sequence}`;
  const email = `${label}@platform.test`;
  const password = `synthetic-password-${label}`;
  const phone = `+9197${String(Date.now()).slice(-6)}${String(sequence).padStart(2, "0")}`;
  const { id, totpSecret } = await provisionPlatformUser({ email, name: label, password, role });
  ids.push(id); phones.push(phone);
  await markTotpEnrolled(id);
  await admin.query("update platform_users set phone=$1 where id=$2", [phone, id]);
  return { id, email, password, phone, totpSecret, role };
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function request(body: unknown, origin = "http://ops.localhost", host = "ops.localhost") {
  return POST(new Request("http://ops.localhost/ops/api/whatsapp-auth", {
    method: "POST",
    headers: { "content-type": "application/json", origin, host,
      cookie: [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ") },
    body: JSON.stringify(body),
  }));
}

function makeCode(secret: string, atMs = Date.now()): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = secret.replace(/=+$/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of cleaned) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`invalid base32 char: ${ch}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  const key = Buffer.from(bytes);
  const counter = Math.floor(atMs / 1000 / 30);
  const counterHex = counter.toString(16).padStart(16, "0");
  const hmac = createHmac("sha1", key)
    .update(Buffer.from(counterHex, "hex"))
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

async function begin(user: Awaited<ReturnType<typeof operator>>) {
  await expect(loginPlatformAction(null, form(user))).rejects.toEqual(new RedirectSignal("/ops/verify"));
  const token = await readPlatformSessionToken();
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(await platformAuthStatusAction()).toMatchObject({kind:"unauthenticated",userId:user.id,role:user.role});
  return token!;
}
async function authenticate(user: Awaited<ReturnType<typeof operator>>) {
  const token = await begin(user);
  await expect(verifyPlatformTotpAction(null, form({code:makeCode(user.totpSecret)}))).rejects.toEqual(new RedirectSignal("/ops"));
  expect(await readPlatformSessionToken()).toBe(token);
  return token;
}

describe("platform authentication boundary", () => {
  it("round-trips and clears the session cookie", async () => {
    await writePlatformSessionCookie("a".repeat(64));
    expect(await readPlatformSessionToken()).toBe("a".repeat(64));
    await clearPlatformSessionCookie();
    expect(await readPlatformSessionToken()).toBeNull();
  });

  it("validates passwords and requires TOTP before granting authority", async () => {
    expect(await loginPlatformAction(null, form({email:"invalid",password:""}))).toEqual({kind:"error",message:"Enter a valid email and password."});
    const user=await operator();
    const unknown=await loginPlatformAction(null,form({email:"missing@platform.test",password:"wrong"}));
    expect(unknown).toMatchObject({kind:"error"});
    expect(await readPlatformSessionToken()).toBeNull();
    await begin(user);
    expect(await requireOpsAdminAction()).toEqual({kind:"error",reason:"unauthenticated"});
  });

  it("refuses TOTP without a password challenge", async () => {
    await expect(verifyPlatformTotpAction(null,form({code:"123456"}))).rejects.toEqual(new RedirectSignal("/ops/login"));
    expect(await readPlatformSessionToken()).toBeNull();
    expect(await platformAuthStatusAction()).toEqual({kind:"not_found"});
  });

  it("refuses disabled WhatsApp login on all hosts without sending OTP", async () => {
    for (const [origin,host] of [["http://ops.localhost","ops.localhost"],["http://evil.test","ops.localhost"],["http://localhost","localhost"]]) {
      const response=await request({intent:"request",phone:"+919000008099"},origin,host);
      expect(response.status).toBe(403);
      expect(response.cookies.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("does not enumerate accounts or authenticate at the disabled WhatsApp endpoint", async () => {
    const user=await operator();
    const known=await request({intent:"request",phone:user.phone});
    const unknown=await request({intent:"request",phone:"+919000009999"});
    expect(known.status).toBe(403);
    expect(await known.json()).toEqual(await unknown.json());
    expect(known.cookies.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
    expect(unknown.cookies.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
    expect((await admin.query("select id from platform_sessions where user_id=$1",[user.id])).rows).toEqual([]);
  });

  it("rejects wrong TOTP, accepts the correct code once and rejects replay", async () => {
    const user=await operator();
    await begin(user);
    const code=makeCode(user.totpSecret);
    const wrong=code === "000000" ? "111111" : "000000";
    expect(await verifyPlatformTotpAction(null,form({code:wrong}))).toMatchObject({kind:"error"});
    expect(await requireOpsAdminAction()).toEqual({kind:"error",reason:"unauthenticated"});
    await expect(verifyPlatformTotpAction(null,form({code}))).rejects.toEqual(new RedirectSignal("/ops"));
    expect(await requireOpsAdminAction()).toEqual({kind:"ok",userId:user.id,role:"admin"});
    expect(await verifyPlatformTotpAction(null,form({code}))).toMatchObject({kind:"error"});
    const sessions=await admin.query("select second_factor_passed from platform_sessions where user_id=$1",[user.id]);
    expect(sessions.rows).toEqual([{second_factor_passed:true}]);
    const audits=await admin.query("select action from platform_audit_log where actor_id=$1 and action='platform.login'",[user.id]);
    expect(audits.rows).toHaveLength(1);
  });

  it("rejects missing and expired TOTP challenges", async () => {
    await expect(verifyPlatformTotpAction(null,form({code:"123456"}))).rejects.toEqual(new RedirectSignal("/ops/login"));
    const user=await operator();
    await begin(user);
    await admin.query("update platform_sessions set expires_at=now()-interval '1 minute' where user_id=$1",[user.id]);
    expect(await verifyPlatformTotpAction(null,form({code:makeCode(user.totpSecret)}))).toMatchObject({kind:"error"});
    expect(await requireOpsAdminAction()).toEqual({kind:"error",reason:"unauthenticated"});
  });

  it("rechecks suspended account status before completing TOTP", async () => {
    const user=await operator();
    await begin(user);
    await admin.query("update platform_users set status='suspended' where id=$1",[user.id]);
    expect(await verifyPlatformTotpAction(null,form({code:makeCode(user.totpSecret)}))).toMatchObject({kind:"error"});
    expect(await requireOpsAdminAction()).toEqual({kind:"error",reason:"unauthenticated"});
  });

  it("reports authenticated identity, and logout revokes both the cookie and persisted session", async () => {
    const user = await operator();
    await authenticate(user);
    expect(await platformAuthStatusAction()).toMatchObject({ kind: "authenticated", userId: user.id, role: "admin" });
    expect(await requireOpsAdminAction()).toEqual({ kind: "ok", userId: user.id, role: "admin" });
    expect(await logoutPlatformAction()).toEqual({ kind: "ok" });
    expect(await readPlatformSessionToken()).toBeNull();
    expect(await platformAuthStatusAction()).toEqual({ kind: "not_found" });
    expect((await admin.query("select id from platform_sessions where user_id=$1", [user.id])).rows).toEqual([]);
  });

  it("authenticates viewers without granting platform mutation authority", async () => {
    const user = await operator("viewer");
    await authenticate(user);
    expect(await platformAuthStatusAction()).toMatchObject({ kind: "authenticated", userId: user.id, role: "viewer" });
    expect(await requireOpsAdminAction()).toEqual({ kind: "error", reason: "forbidden" });
  });
});
