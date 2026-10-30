// @vitest-environment node
//
// Lane a-auth — tenant-host / Ops-host separation for the better-auth
// surface (F5).
//
// The host boundary (middleware.ts + lib/surface-paths.ts) is the only
// thing standing between the two surfaces: the platform session cookie is
// host-scoped, so the browser never sends it to the tenant apex and never
// sends a tenant session to the platform host. But a cookie is only a
// browser convention — a caller that transmits the token by hand (curl,
// an attacker script) is not bound by it.
//
// The requirement being checked (docs/audits/2026-09-27-complete-codebase-
// assessment.md:30 — "No tenant staff session is an ops session"): the
// tenant's better-auth surface must not be served from the Ops host.
//
// Before the fix the Ops allowlist admitted "/api/auth/", so a TENANT
// better-auth session token was accepted by the platform host's
// /api/auth/* endpoints.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture);
// every behavioural assertion runs through the application's own services
// on the app_login runtime connection.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { NextRequest } from "next/server";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { db } from "@/db/client";
import { withPlatform } from "@/db/scope";
import { users } from "@/db/schema/users";
import { baUser } from "@/db/schema/better-auth";
import { seedRoleTemplates } from "@/lib/services/roles";
import { auth } from "@/lib/auth/server";
import { APEX_ALLOWLIST, OPS_ALLOWLIST, isAllowed } from "@/lib/surface-paths";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const OPS_HOST = "aquaops.harness.test";
const APEX_HOST = "aqua.harness.test";
const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const phone = `+91985${RUN_NUM}01`;

let tenantId: TenantId = asTenantId("");
let userId: UserId = asUserId("");
let baId = "";
let sessionToken = "";

beforeAll(async () => {
  vi.stubEnv("OPS_HOST", OPS_HOST);
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'a-auth host boundary', $3, 'Asia/Kolkata')",
    [tenantId, `a-auth-host-${RUN}`, plan?.id ?? null],
  );
  await seedRoleTemplates(tenantId);
  const roleRow = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1::uuid and key = 'owner'",
    [tenantId],
  );
  userId = asUserId(uuidv7());
  await withPlatform(async () => {
    await db.insert(users).values({ id: userId, phone });
  });
  baId = uuidv7();
  await withPlatform(async () => {
    await db.insert(baUser).values({
      id: baId,
      name: phone,
      email: `${phone}@phone.aqua.local`,
      phoneNumber: phone,
      phoneNumberVerified: true,
    });
  });
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
     values ($1, $2::uuid, $3, $4, 'active')`,
    [uuidv7(), tenantId, userId, roleRow.rows[0]!.id],
  );
  // A real tenant session, minted by the application's own better-auth
  // adapter on the app_login connection.
  const session = await withPlatform(() =>
    auth.$context.then((ctx) => ctx.internalAdapter.createSession(baId)),
  );
  sessionToken = (session as { token: string }).token;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (tenantId) {
    await admin.query("delete from tenant_memberships where tenant_id = $1", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.query(
    "delete from ba_session where user_id in (select id from ba_user where phone_number = $1)",
    [phone],
  );
  await admin.query("delete from ba_user where phone_number = $1", [phone]);
  await admin.query("delete from users where phone = $1", [phone]);
  await admin.end();
});

/** The signed cookie better-auth expects for a raw session token. */
async function tenantSessionCookie(): Promise<string> {
  const baCtx = await auth.$context;
  const signature = createHmac("sha256", baCtx.secret).update(sessionToken).digest("base64");
  return `${baCtx.authCookies.sessionToken.name}=${sessionToken}.${signature}`;
}

function opsRequest(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://${OPS_HOST}${path}`, {
    headers: { host: OPS_HOST, ...(cookie ? { cookie } : {}) },
  });
}

function apexRequest(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://${APEX_HOST}${path}`, {
    headers: { host: APEX_HOST, ...(cookie ? { cookie } : {}) },
  });
}

describe("the Ops host does not serve the tenant better-auth surface", () => {
  it("does not admit /api/auth/ on the Ops allowlist", () => {
    expect(isAllowed("/api/auth/get-session", OPS_ALLOWLIST)).toBe(false);
    expect(isAllowed("/api/auth/sign-in/email", OPS_ALLOWLIST)).toBe(false);
  });

  it("the middleware refuses a tenant /api/auth request on the Ops host", async () => {
    const { middleware } = await import("@/middleware");
    const response = middleware(opsRequest("/api/auth/get-session"));
    expect(response.status).toBe(404);
  });

  it("the better-auth handler itself is host-agnostic — the routing layer is the boundary", async () => {
    // The route handler does not read the Host header: in this app the
    // host boundary lives in middleware.ts, which 404s anything the
    // host's allowlist does not admit (the test above). This assertion
    // pins that fact so nobody later mistakes the handler for the
    // boundary — if the middleware's allowlist were relaxed, THIS test
    // would still pass while the boundary test above fails.
    const { GET } = await import("@/app/api/auth/[...all]/route");
    const cookie = await tenantSessionCookie();
    const response = await GET(
      new Request(`http://localhost:3199/api/auth/get-session`, {
        headers: { host: OPS_HOST, cookie },
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("the tenant host keeps its legitimate better-auth surface", () => {
  it("still admits /api/auth/ on the apex allowlist", () => {
    expect(isAllowed("/api/auth/get-session", APEX_ALLOWLIST)).toBe(true);
  });

  it("the middleware lets a tenant /api/auth request through on the apex", async () => {
    const { middleware } = await import("@/middleware");
    const response = middleware(apexRequest("/api/auth/get-session"));
    expect(response.status).not.toBe(404);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("the tenant session still resolves on the apex", async () => {
    const { GET } = await import("@/app/api/auth/[...all]/route");
    const cookie = await tenantSessionCookie();
    const response = await GET(
      new Request(`http://localhost:3199/api/auth/get-session`, {
        headers: { host: APEX_HOST, cookie },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user?: { id?: string } };
    expect(body.user?.id).toBe(baId);
  });
});

describe("the Ops password + authenticator surface is untouched", () => {
  it("still serves the Ops paths on the Ops host", () => {
    expect(isAllowed("/ops/login", OPS_ALLOWLIST)).toBe(true);
    expect(isAllowed("/ops/verify", OPS_ALLOWLIST)).toBe(true);
    expect(isAllowed("/ops", OPS_ALLOWLIST)).toBe(true);
  });

  it("the middleware still lets /ops/login through on the Ops host", async () => {
    const { middleware } = await import("@/middleware");
    const response = middleware(opsRequest("/ops/login"));
    expect(response.status).not.toBe(404);
  });

  it("the Ops host still refuses the tenant sign-in doors", () => {
    expect(isAllowed("/api/login/pin", OPS_ALLOWLIST)).toBe(false);
    expect(isAllowed("/api/login-link/redeem", OPS_ALLOWLIST)).toBe(false);
    expect(isAllowed("/api/account/set-pin", OPS_ALLOWLIST)).toBe(false);
  });
});
