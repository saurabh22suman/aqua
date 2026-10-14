import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
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
const challengeCookie = "aqua_whatsapp_ops_login";

afterEach(() => { cookieJar.clear(); send.mockClear(); });
afterAll(async () => {
  await admin.query("delete from whatsapp_auth_challenges where phone=any($1::text[])", [phones]);
  await admin.query("delete from platform_sessions where user_id=any($1::uuid[])", [ids]);
  await admin.query("delete from platform_audit_log where actor_id=any($1::uuid[])", [ids]);
  await admin.query("delete from platform_users where id=any($1::uuid[])", [ids]);
  await admin.end();
});

async function operator(role: "admin" | "viewer" = "admin") {
  const label = `${RUN}-${++sequence}`;
  const email = `${label}@platform.test`;
  const password = `synthetic-password-${label}`;
  const phone = `+9197${String(Date.now()).slice(-6)}${String(sequence).padStart(2, "0")}`;
  const { id } = await provisionPlatformUser({ email, name: label, password, role });
  ids.push(id); phones.push(phone);
  await markTotpEnrolled(id);
  await admin.query("update platform_users set phone=$1 where id=$2", [phone, id]);
  return { id, email, password, phone };
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

async function challenge(phone: string) {
  const response = await request({ intent: "request", phone });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ step: "code" });
  const token = response.cookies.get(challengeCookie)?.value;
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
  cookieJar.set(challengeCookie, token!);
  const code = send.mock.calls.at(-1)?.[0].body.match(/code is (\d{6})/)?.[1];
  if (!code) throw new Error("Synthetic transport did not receive an OTP");
  return code;
}

async function authenticate(user: Awaited<ReturnType<typeof operator>>) {
  const code = await challenge(user.phone);
  const response = await request({ intent: "verify", code });
  expect(await response.json()).toEqual({ step: "done", redirectPath: "/ops" });
  const token = response.cookies.get(PLATFORM_COOKIE_NAME)?.value;
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  cookieJar.set(PLATFORM_COOKIE_NAME, token!);
  return token!;
}

describe("platform authentication boundary", () => {
  it("round-trips and clears the session cookie", async () => {
    await writePlatformSessionCookie("a".repeat(64));
    expect(await readPlatformSessionToken()).toBe("a".repeat(64));
    await clearPlatformSessionCookie();
    expect(await readPlatformSessionToken()).toBeNull();
  });

  it("validates legacy input but never authenticates even a correct password", async () => {
    expect(await loginPlatformAction(null, form({ email: "invalid", password: "" })))
      .toEqual({ kind: "error", message: "Enter a valid email and password." });
    const user = await operator();
    const known = await loginPlatformAction(null, form(user));
    const unknown = await loginPlatformAction(null, form({ email: "missing@platform.test", password: "wrong" }));
    expect(known).toEqual(unknown);
    expect(known).toEqual({ kind: "error", message: "Use your registered phone and WhatsApp code to sign in." });
    expect(await readPlatformSessionToken()).toBeNull();
    expect((await admin.query("select id from platform_sessions where user_id=$1", [user.id])).rows).toEqual([]);
  });

  it("legacy TOTP cannot upgrade a session and redirects back to login", async () => {
    const user = await operator();
    await authenticate(user);
    await expect(verifyPlatformTotpAction(null, form({ code: "123456" })))
      .rejects.toEqual(new RedirectSignal("/ops/login"));
    expect(await readPlatformSessionToken()).toBeNull();
    expect(await platformAuthStatusAction()).toEqual({ kind: "not_found" });
  });

  it("rejects invalid input and cross-host/origin requests without sending an OTP", async () => {
    expect((await request({ intent: "request", phone: "" })).status).toBe(400);
    expect(await (await request({ intent: "request", phone: "invalid" })).json())
      .toMatchObject({ step: "phone", error: expect.any(String) });
    expect((await request({ intent: "request", phone: "+919000008099" }, "http://evil.test")).status).toBe(403);
    expect((await request({ intent: "request", phone: "+919000008099" }, "http://localhost", "localhost")).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not enumerate accounts or authenticate at the challenge-request stage", async () => {
    const user = await operator();
    const known = await request({ intent: "request", phone: user.phone });
    const unknownPhone = "+919000009999";
    phones.push(unknownPhone);
    const unknown = await request({ intent: "request", phone: unknownPhone });
    expect(await known.json()).toEqual(await unknown.json());
    expect(known.cookies.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
    expect(unknown.cookies.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
    expect((await admin.query("select id from platform_sessions where user_id=$1", [user.id])).rows).toEqual([]);
  });

  it("rejects a wrong OTP, then authenticates once with the valid browser-bound OTP", async () => {
    const user = await operator();
    const code = await challenge(user.phone);
    const wrong = code === "000000" ? "111111" : "000000";
    const rejected = await request({ intent: "verify", code: wrong });
    expect(await rejected.json()).toMatchObject({ step: "code", error: expect.any(String) });
    expect(rejected.cookies.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
    expect((await admin.query("select id from platform_sessions where user_id=$1", [user.id])).rows).toEqual([]);
    const accepted = await request({ intent: "verify", code });
    expect(await accepted.json()).toEqual({ step: "done", redirectPath: "/ops" });
    expect(accepted.cookies.get(challengeCookie)?.value).toBe("");
    const replay = await request({ intent: "verify", code });
    expect(await replay.json()).toMatchObject({ step: "code", error: expect.any(String) });
    expect(replay.cookies.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
    const sessions = await admin.query("select second_factor_passed from platform_sessions where user_id=$1", [user.id]);
    expect(sessions.rows).toEqual([{ second_factor_passed: true }]);
    const audits = await admin.query("select detail from platform_audit_log where actor_id=$1 and action='platform.login'", [user.id]);
    expect(audits.rows).toEqual([{ detail: { method: "whatsapp_otp" } }]);
  });

  it("rejects missing and expired challenges without creating a session", async () => {
    expect(await (await request({ intent: "verify", code: "123456" })).json())
      .toMatchObject({ step: "phone", error: expect.any(String) });
    const user = await operator();
    const code = await challenge(user.phone);
    await admin.query("update whatsapp_auth_challenges set expires_at=now()-interval '1 minute' where phone=$1", [user.phone]);
    const response = await request({ intent: "verify", code });
    expect(await response.json()).toMatchObject({ step: "code", error: expect.any(String) });
    expect(response.cookies.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
    expect((await admin.query("select id from platform_sessions where user_id=$1", [user.id])).rows).toEqual([]);
  });

  it("rechecks account status before issuing a session", async () => {
    const user = await operator();
    const code = await challenge(user.phone);
    await admin.query("update platform_users set status='suspended' where id=$1", [user.id]);
    const response = await request({ intent: "verify", code });
    expect(await response.json()).toHaveProperty("error");
    expect(response.cookies.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
    expect((await admin.query("select id from platform_sessions where user_id=$1", [user.id])).rows).toEqual([]);
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
