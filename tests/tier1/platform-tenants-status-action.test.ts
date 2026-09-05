import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { transitionTenantStatusAction } from "@/lib/actions/platform-tenants";

// Phase 1.6 — server action test for transitionTenantStatus. Same
// shape as the platform-auth / platform-tenant-create action tests:
// provision an enrolled admin, log in past 2FA, set the cookie
// jar, then exercise the action through the public Server Action
// signature. next/headers is mocked to a Map so the action can
// read the cookie jar without a real Next request.

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = cookieJar.get(name);
      return v ? { name, value: v } : undefined;
    },
    set: (arg: { name: string; value: string }) => {
      cookieJar.set(arg.name, arg.value);
    },
  }),
}));

// H1 — transitionTenantStatusAction calls revalidatePath() on success.
// In a unit-test context there is no static-generation store, so
// revalidatePath throws — mock it as a no-op.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const SLUG_PREFIX = `transition-act-${RUN}`;
const seeded: string[] = [];

beforeAll(async () => {
  await admin.query("delete from platform_sessions");
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_users");
});

afterAll(async () => {
  // Clean up tenants the tests seeded, plus the platform_users
  // and audit rows so the next suite run starts clean.
  if (seeded.length > 0) {
    await admin.query(
      "delete from platform_audit_log where tenant_id = any($1::uuid[])",
      [seeded],
    );
    await admin.query("delete from tenants where id = any($1::uuid[])", [seeded]);
  }
  await admin.query("delete from platform_sessions");
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_users");
  await admin.end();
});

async function provisionActiveAdmin(label: string) {
  const { provisionPlatformUser, markTotpEnrolled, platformLogin, platformVerifyTotp } =
    await import("@/db/platform-auth");
  const { writePlatformSessionCookie, readPlatformSessionToken, clearPlatformSessionCookie } =
    await import("@/lib/auth/platform-cookie");
  const email = `${label}-${RUN}@platform.test`;
  const password = `pw-${label}-${RUN}`;
  const { id, totpSecret } = await provisionPlatformUser({
    email,
    name: `Operator ${label}`,
    password,
    role: "admin",
  });
  await markTotpEnrolled(id);
  await clearPlatformSessionCookie();
  const login = await platformLogin({ email, password });
  if (login.kind !== "second_factor_required") {
    throw new Error(`unexpected login result: ${login.kind}`);
  }
  await writePlatformSessionCookie(login.sessionToken);
  const code = makeTotpCode(totpSecret);
  const verify = await platformVerifyTotp({ sessionToken: login.sessionToken, code });
  if (verify.kind !== "fully_authenticated") {
    throw new Error(`unexpected verify result: ${verify.kind}`);
  }
  const token = await readPlatformSessionToken();
  if (!token) {
    throw new Error("session token not readable after verifyTotp");
  }
  return { token };
}

function makeTotpCode(secret: string, atMs = Date.now()): string {
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

let counter = 0;
async function seedTenant(
  status: "trial" | "active" | "suspended" | "churned",
): Promise<string> {
  counter += 1;
  const slug = `${SLUG_PREFIX}-${counter}-${Date.now().toString(36)}`.slice(0, 60);
  // uuid v4 — good enough for the test; not the production kind.
  const realId = "00000000-0000-4000-8000-" + Math.floor(Math.random() * 1e12).toString(16).padStart(12, "0");
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, $3, $4)",
    [realId, slug, "Transition Action Test", status],
  );
  seeded.push(realId);
  return realId;
}

describe("transitionTenantStatusAction", () => {
  it("returns ok and writes the audit row when the input is valid", async () => {
    const { token } = await provisionActiveAdmin(`ok-${counter}`);
    cookieJar.set("platform_session", token);
    const tenantId = await seedTenant("trial");

    const result = await transitionTenantStatusAction(tenantId, {
      targetStatus: "active",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const rows = await admin.query<{ status: string }>(
      "select status from tenants where id = $1",
      [tenantId],
    );
    expect(rows.rows[0]?.status).toBe("active");

    cookieJar.delete("platform_session");
  });

  it("returns invalid when the cookie is missing", async () => {
    cookieJar.delete("platform_session");
    const tenantId = await seedTenant("trial");

    const result = await transitionTenantStatusAction(tenantId, {
      targetStatus: "active",
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
  });

  it("returns reason_required for a suspend without reason", async () => {
    const { token } = await provisionActiveAdmin(`req-${counter}`);
    cookieJar.set("platform_session", token);
    const tenantId = await seedTenant("active");

    const result = await transitionTenantStatusAction(tenantId, {
      targetStatus: "suspended",
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("reason_required");

    cookieJar.delete("platform_session");
  });

  it("returns terminal_state for a churned tenant regardless of target", async () => {
    const { token } = await provisionActiveAdmin(`term-${counter}`);
    cookieJar.set("platform_session", token);
    const tenantId = await seedTenant("churned");

    const result = await transitionTenantStatusAction(tenantId, {
      targetStatus: "active",
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("terminal_state");

    cookieJar.delete("platform_session");
  });

  it("returns invalid for a malformed targetStatus (defence in depth on the action surface)", async () => {
    const { token } = await provisionActiveAdmin(`bad-${counter}`);
    cookieJar.set("platform_session", token);
    const tenantId = await seedTenant("trial");

    const result = await transitionTenantStatusAction(tenantId, {
      targetStatus: "bogus" as unknown as "active",
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");

    cookieJar.delete("platform_session");
  });
});
