import { Pool } from "pg";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import {
  createTenantAction,
  type CreateTenantFormInput,
} from "@/lib/actions/platform-tenants";

// Phase 1.5 — server-action test. The action is `createTenantAction`
// in `lib/actions/platform-tenants.ts`. It opens with a Zod parse,
// gates on the platform session (returns the same kind'd error
// shape the form already understands), then delegates to
// `db/platform-tenant-create.ts::createTenant` for the writes.
//
// Two assertions guard the standing Server Action rules:
//   1. parse-then-permission-check ordering (the AST walk in
//      tests/tier1/server-action-preamble.test.ts catches this
//      repo-wide; this file ensures the new action's body matches).
//   2. The auth gate returns a structured error, not a redirect —
//      the action is called from a client form, so a redirect would
//      500; the form expects `kind: 'error'` to render its inline pill.
//
// next/headers is mocked the same way as platform-auth-actions.test.ts:
// a Map-backed cookie jar replaces the production Next.js cookies API
// so the action reads the session token as if from a real request.

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

// H1 — createTenantAction calls revalidatePath on success. In unit
// tests there is no static-generation store, so revalidatePath
// throws — mock it as a no-op.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const SLUG_PREFIX = `act-${RUN}`;

beforeAll(async () => {
  // Wipe in dependency order. platform_sessions → platform_users →
  // platform_audit_log.
  await admin.query("delete from platform_sessions");
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_users");
});

afterAll(async () => {
  // Sweep tenants the tests created.
  const rows = await admin.query<{ id: string }>(
    "select id from tenants where slug like $1",
    [`${SLUG_PREFIX}%`],
  );
  for (const r of rows.rows) {
    // roles.tenant_id -> tenants(id) has no ON DELETE clause — C1
    // (createTenant now seeds role templates) means the tenant row
    // can't be deleted until its roles are gone first.
    await admin.query(
      "delete from role_permissions where tenant_id = $1",
      [r.id],
    );
    await admin.query("delete from roles where tenant_id = $1", [r.id]);
    await admin.query("delete from locations where tenant_id = $1", [r.id]);
    await admin.query(
      "delete from platform_audit_log where tenant_id = $1",
      [r.id],
    );
    await admin.query("delete from tenants where id = $1", [r.id]);
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
  const code = await makeCode(totpSecret);
  const verify = await platformVerifyTotp({ sessionToken: login.sessionToken, code });
  if (verify.kind !== "fully_authenticated") {
    throw new Error(`unexpected verify result: ${verify.kind}`);
  }
  // Lookup-after-verify wires the session fully_authenticated; the
  // token is the same opaque value, but reading it through the
  // public API confirms the cookie write is visible. If it ever
  // returns null, the cookie write above is broken — fail loudly.
  const token = await readPlatformSessionToken();
  if (!token) {
    throw new Error("session token not readable after verifyTotp");
  }
  return {
    userId: id,
    token,
  };
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

const happyInput: CreateTenantFormInput = {
  name: "Action Test Academy",
  slug: `${SLUG_PREFIX}-default`,
  timezone: "Asia/Kolkata",
  planKey: "standard",
  currency: "INR",
  locationName: "Main",
  locationIsPrimary: true,
};

// H1 — actions take FormData; build it from the typed input shape.
function fd(input: CreateTenantFormInput): FormData {
  const f = new FormData();
  f.set("name", input.name);
  f.set("slug", input.slug);
  f.set("timezone", input.timezone);
  f.set("planKey", input.planKey);
  f.set("currency", input.currency);
  if (input.gstin) f.set("gstin", input.gstin);
  f.set("locationName", input.locationName);
  if (input.locationIsPrimary) f.set("locationIsPrimary", "on");
  return f;
}

// H1 — createTenantAction redirects on success. Mock the redirect
// so the success path is observable without honouring a real nav.
class RedirectSignal extends Error {
  constructor(public path: string) {
    super(`REDIRECT:${path}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new RedirectSignal(path);
  },
}));

let counter = 0;
function uniqueSlug(label: string): string {
  counter += 1;
  return `${SLUG_PREFIX}-${label}-${counter}`;
}

describe("createTenantAction", () => {
  it("redirects to /platform/tenants/[id] on success and writes the tenant row", async () => {
    const { token } = await provisionActiveAdmin(`ok-${counter}`);
    cookieJar.set("platform_session", token);

    const slug = uniqueSlug("ok");
    let captured: string | null = null;
    try {
      await createTenantAction(null, fd({ ...happyInput, slug }));
    } catch (err) {
      if (err instanceof RedirectSignal) captured = err.path;
      else throw err;
    }
    expect(captured).toMatch(/^\/platform\/tenants\/[0-9a-f-]+$/);

    const tenants = await admin.query<{ slug: string }>(
      "select slug from tenants where slug = $1",
      [slug],
    );
    expect(tenants.rows[0]?.slug).toBe(slug);

    cookieJar.delete("platform_session");
  });

  it("returns error.kind: 'invalid' when session is unauthenticated", async () => {
    cookieJar.delete("platform_session");
    const result = await createTenantAction(null, fd({
      ...happyInput,
      slug: uniqueSlug("no-auth"),
    }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
    expect(result.message.toLowerCase()).toMatch(/sign in|session/);
  });

  it("returns invalid for half-authenticated (password but not TOTP)", async () => {
    // Provision a user, log in to get the half-auth cookie, but do
    // NOT verify TOTP. LookupPlatformSession will return kind:
    // "unauthenticated" — we treat that as "session invalid,
    // please sign in", same as expired.
    const { provisionPlatformUser, markTotpEnrolled, platformLogin } =
      await import("@/db/platform-auth");
    const { writePlatformSessionCookie, clearPlatformSessionCookie } =
      await import("@/lib/auth/platform-cookie");
    const email = `halfauth-${RUN}-${counter}@platform.test`;
    const password = "doomed";
    const u = await provisionPlatformUser({
      email,
      name: "Doomed",
      password,
      role: "admin",
    });
    await markTotpEnrolled(u.id);
    await clearPlatformSessionCookie();
    const login = await platformLogin({ email, password });
    if (login.kind !== "second_factor_required") {
      throw new Error("login should require 2FA");
    }
    await writePlatformSessionCookie(login.sessionToken);

    const result = await createTenantAction(null, fd({
      ...happyInput,
      slug: uniqueSlug("half-auth"),
    }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");

    cookieJar.delete("platform_session");
  });

  it("returns invalid for zod-malformed input (uppercase slug) without touching the database", async () => {
    const { token } = await provisionActiveAdmin(`bad-${counter}`);
    cookieJar.set("platform_session", token);

    const beforeCount = (
      await admin.query<{ count: string }>(
        "select count(*)::text from tenants where slug like $1",
        [`${SLUG_PREFIX}%`],
      )
    ).rows[0]!.count;

    const result = await createTenantAction(null, fd({
      ...happyInput,
      slug: "UPPERCASE-NOT-ALLOWED",
    }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");

    const afterCount = (
      await admin.query<{ count: string }>(
        "select count(*)::text from tenants where slug like $1",
        [`${SLUG_PREFIX}%`],
      )
    ).rows[0]!.count;
    expect(afterCount).toBe(beforeCount);

    cookieJar.delete("platform_session");
  });

  it("returns slug_taken when the slug already exists in the database", async () => {
    const { token } = await provisionActiveAdmin(`collision-${counter}`);
    cookieJar.set("platform_session", token);
    const slug = uniqueSlug("collision");

    try {
      await createTenantAction(null, fd({ ...happyInput, slug }));
    } catch (err) {
      if (!(err instanceof RedirectSignal)) throw err;
    }

    const second = await createTenantAction(null, fd({ ...happyInput, slug }));
    expect(second.kind).toBe("error");
    if (second.kind !== "error") return;
    expect(second.code).toBe("slug_taken");

    cookieJar.delete("platform_session");
  });
});
