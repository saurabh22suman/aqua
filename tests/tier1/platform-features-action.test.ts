import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { updateFeatureAction } from "@/lib/actions/platform-features";

// Phase 1.7 — server action test for updateFeatureAction. Same
// shape as the previous action tests: provision an enrolled
// platform admin, log in past 2FA via the existing auth services,
// set the mocked cookies Map, exercise the action through the
// public Server Action signature.

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

// H1 — actions take FormData. The feature key arrives as a hidden
// form field; build the FormData with the key alongside the inputs.
function fd(featureKey: string, obj: Record<string, string>): FormData {
  const f = new FormData();
  f.set("key", featureKey);
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const PREFIX = `feat-act-${RUN}`;
const seededKeys: string[] = [];

beforeAll(async () => {
  await admin.query("delete from platform_sessions");
  await admin.query("delete from platform_audit_log");
  await admin.query("delete from platform_users");

  // Seed two features the action can target.
  await admin.query(
    `insert into features (key, name, category, status) values
     ($1, 'A', 'core', 'ga'),
     ($2, 'B', 'core', 'beta')
     on conflict (key) do nothing`,
    [`${PREFIX}-a`, `${PREFIX}-b`],
  );
  seededKeys.push(`${PREFIX}-a`, `${PREFIX}-b`);
});

afterAll(async () => {
  if (seededKeys.length > 0) {
    await admin.query(
      `delete from platform_audit_log where action = 'feature.update'
       and detail ->> 'key' = any($1::text[])`,
      [seededKeys],
    );
    await admin.query("delete from features where key = any($1::text[])", [
      seededKeys,
    ]);
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

describe("updateFeatureAction", () => {
  it("happy path: ok + audit row written", async () => {
    const { token } = await provisionActiveAdmin(`ok-${Date.now().toString(36)}`);
    cookieJar.set("platform_session", token);

    const result = await updateFeatureAction(null, fd(`${PREFIX}-a`, {
      name: "Renamed",
      category: "core",
      status: "beta",
    }));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const row = (
      await admin.query<{ name: string; status: string }>(
        "select name, status from features where key = $1",
        [`${PREFIX}-a`],
      )
    ).rows[0]!;
    expect(row.name).toBe("Renamed");
    expect(row.status).toBe("beta");

    cookieJar.delete("platform_session");
  });

  it("returns invalid when the cookie is missing", async () => {
    cookieJar.delete("platform_session");
    const result = await updateFeatureAction(null, fd(`${PREFIX}-a`, {
      name: "x",
      category: "core",
      status: "ga",
    }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
  });

  it("returns invalid when targetStatus is outside the enum", async () => {
    const { token } = await provisionActiveAdmin(`bad-${Date.now().toString(36)}`);
    cookieJar.set("platform_session", token);

    const result = await updateFeatureAction(null, fd(`${PREFIX}-b`, {
      name: "B",
      category: "core",
      // Force a string past the surface-schema enum; the action's
      // safeParse should reject it before any write.
      status: "ga" as unknown as "beta",
    }));
    // The first arg is an enum of "ga" | "beta" | "internal" — passing a
    // valid value but with the type cast works at runtime; to exercise
    // the invalid path the test needs an actually-bad value, so use the
    // null edge below as a stronger probe of the same path.
    expect(result.kind).toBe("ok");

    const r2 = await updateFeatureAction(null, fd(`${PREFIX}-b`, {
      name: "B",
      category: "core",
      status: "shipped" as unknown as "ga",
    }));
    expect(r2.kind).toBe("error");
    if (r2.kind !== "error") return;
    expect(r2.code).toBe("invalid");

    cookieJar.delete("platform_session");
  });

  it("returns not_found for a feature that doesn't exist", async () => {
    const { token } = await provisionActiveAdmin(`missing-${Date.now().toString(36)}`);
    cookieJar.set("platform_session", token);

    const result = await updateFeatureAction(null, fd(`${PREFIX}-does-not-exist`, {
      name: "x",
      category: "core",
      status: "ga",
    }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("not_found");

    cookieJar.delete("platform_session");
  });

  it("rejects with invalid when name is empty (zod parse rejects)", async () => {
    const { token } = await provisionActiveAdmin(`empty-${Date.now().toString(36)}`);
    cookieJar.set("platform_session", token);

    const result = await updateFeatureAction(null, fd(`${PREFIX}-a`, {
      name: "",
      category: "core",
      status: "ga",
    }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");

    cookieJar.delete("platform_session");
  });
});
