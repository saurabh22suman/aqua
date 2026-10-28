import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { env } from "@/lib/env";
import { provisionPlatformUser, markTotpEnrolled, currentTotpCode, verifyTotp } from "@/db/platform-auth";
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
  headers: async () => new Headers(),
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
  await admin.query("delete from platform_audit_log where actor_id=any($1::uuid[])", [ids]);
  await admin.query("delete from platform_users where id=any($1::uuid[])", [ids]);
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
  return { id, email, password, phone, totpSecret };
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

async function passwordChallenge(user: Awaited<ReturnType<typeof operator>>) {
  await expect(loginPlatformAction(null, form({ email: user.email, password: user.password })))
    .rejects.toEqual(new RedirectSignal("/ops/verify"));
  expect(await platformAuthStatusAction()).toMatchObject({ kind: "unauthenticated", userId: user.id });
  expect(await requireOpsAdminAction()).toEqual({ kind: "error", reason: "unauthenticated" });
}
async function authenticate(user: Awaited<ReturnType<typeof operator>>) {
  await passwordChallenge(user);
  await expect(verifyPlatformTotpAction(null, form({ code: currentTotpCode(user.totpSecret) })))
    .rejects.toEqual(new RedirectSignal("/ops"));
  const token = await readPlatformSessionToken();
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  return token!;
}

describe("platform authentication boundary — password plus authenticator", () => {
  it("round-trips and clears the host session cookie", async () => {
    await writePlatformSessionCookie("a".repeat(64));
    expect(await readPlatformSessionToken()).toBe("a".repeat(64));
    await clearPlatformSessionCookie();
    expect(await readPlatformSessionToken()).toBeNull();
  });
  it("validates input and gives the same response for unknown accounts and wrong passwords", async () => {
    expect(await loginPlatformAction(null, form({ email: "invalid", password: "" })))
      .toEqual({ kind: "error", message: "Enter a valid email and password." });
    const user = await operator();
    const wrong = await loginPlatformAction(null, form({ email: user.email, password: "wrong" }));
    const unknown = await loginPlatformAction(null, form({ email: `${RUN}@missing.test`, password: "wrong" }));
    expect(wrong).toEqual(unknown);
    expect(wrong).toMatchObject({ kind: "error" });
    expect(await readPlatformSessionToken()).toBeNull();
    expect((await admin.query("select id from platform_sessions where user_id=$1", [user.id])).rows).toEqual([]);
  });
  it("password alone grants no Ops authority; a wrong code cannot promote the pending session", async () => {
    const user = await operator();
    await passwordChallenge(user);
    const wrong = ["000000", "111111", "222222"].find(code => !verifyTotp(user.totpSecret, code))!;
    expect(await verifyPlatformTotpAction(null, form({ code: wrong }))).toMatchObject({ kind: "error" });
    expect(await platformAuthStatusAction()).toMatchObject({ kind: "unauthenticated" });
    expect(await requireOpsAdminAction()).toEqual({ kind: "error", reason: "unauthenticated" });
  });
  it("rejects invalid input and cross-host/origin requests without sending an OTP", async () => {
    expect((await request({ intent: "request", phone: "" })).status).toBe(400);
    expect((await request({ intent: "request", phone: "invalid" })).status).toBe(403);
    expect((await request({ intent: "request", phone: "+919000008099" }, "http://evil.test")).status).toBe(403);
    expect((await request({ intent: "request", phone: "+919000008099" }, "http://localhost", "localhost")).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it("denies legacy WhatsApp login equally for known and unknown accounts, including verification/replay", async () => {
    const user = await operator();
    const known = await request({ intent: "request", phone: user.phone });
    const unknown = await request({ intent: "request", phone: "+919000009999" });
    expect(known.status).toBe(403); expect(unknown.status).toBe(403);
    expect(await known.json()).toEqual(await unknown.json());
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request({ intent: "verify", code: "123456" });
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(known.cookies.get(PLATFORM_COOKIE_NAME)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect((await admin.query("select id from platform_sessions where user_id=$1", [user.id])).rows).toEqual([]);
  });
  it("completes one password challenge once and records the authenticator login", async () => {
    const user = await operator();
    await authenticate(user);
    expect(await verifyPlatformTotpAction(null, form({ code: currentTotpCode(user.totpSecret) })))
      .toMatchObject({ kind: "error" });
    const sessions = await admin.query("select second_factor_passed from platform_sessions where user_id=$1", [user.id]);
    expect(sessions.rows).toEqual([{ second_factor_passed: true }]);
    const audits = await admin.query("select detail from platform_audit_log where actor_id=$1 and action='platform.login'", [user.id]);
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0].detail).toMatchObject({ method: "password_totp", phase: "totp" });
  });
  it("rejects missing and expired password challenges without full authentication", async () => {
    await expect(verifyPlatformTotpAction(null, form({ code: "123456" })))
      .rejects.toEqual(new RedirectSignal("/ops/login"));
    const user = await operator();
    await passwordChallenge(user);
    await admin.query("update platform_sessions set expires_at=now()-interval '1 minute' where user_id=$1", [user.id]);
    expect(await verifyPlatformTotpAction(null, form({ code: currentTotpCode(user.totpSecret) })))
      .toMatchObject({ kind: "error" });
    expect(await platformAuthStatusAction()).toEqual({ kind: "expired" });
    expect(await requireOpsAdminAction()).toEqual({ kind: "error", reason: "unauthenticated" });
  });
  it("rechecks account suspension between password and authenticator", async () => {
    const user = await operator();
    await passwordChallenge(user);
    await admin.query("update platform_users set status='suspended' where id=$1", [user.id]);
    expect(await verifyPlatformTotpAction(null, form({ code: currentTotpCode(user.totpSecret) })))
      .toMatchObject({ kind: "error" });
    expect(await platformAuthStatusAction()).toEqual({ kind: "not_found" });
    expect((await admin.query("select id from platform_sessions where user_id=$1 and second_factor_passed=true", [user.id])).rows).toEqual([]);
  });
  it("reports identity and logout revokes both cookie and persisted session", async () => {
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
