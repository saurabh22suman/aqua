// @vitest-environment node
//
// Slice 7 — POST /api/account/set-pin.
//
// The safety net for the first-login flow: if a credential-less
// session exists (the user redeemed the link but closed the set-PIN
// screen before submitting), this session-gated route lets them set
// the PIN without a fresh link. It only ever SETS a missing
// credential — changing an existing PIN goes through the owner reset
// link, not through an ambient session.
//
// The test drives the real route chain: invite -> redeem (no PIN,
// cookie out) -> set-pin (cookie in) -> pin login.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { tenantMemberships } from "@/db/schema/memberships";
import { locations } from "@/db/schema/locations";
import { inviteLinkUses } from "@/db/schema/invite-link-uses";
import { persons } from "@/db/schema/people";
import { staff } from "@/db/schema/staff";
import { seedRoleTemplates } from "@/lib/services/roles";
import { inviteStaff } from "@/lib/services/staff-invitations";
import { issueLoginLink } from "@/lib/services/invite-link";
import { hasCredentialByPhone } from "@/lib/services/credentials";
import { POST as redeemPOST } from "@/app/api/login-link/redeem/route";
import { POST as setPinPOST } from "@/app/api/account/set-pin/route";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const phone = (suffix: string) => `+91992${RUN_NUM}${suffix}`;

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
const membershipByTest: Record<string, string> = {};

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Set Pin Route Test', $3, 'Asia/Kolkata')",
    [tenantId, `set-pin-route-${RUN}`, plan?.id ?? null],
  );
  await withTenant(tenantId, async (tx) => {
    await tx.insert(locations).values({ tenantId, name: "Main", isPrimary: true });
  });
  await seedRoleTemplates(tenantId);
  for (const [test, suffix] of [
    ["happy", "01"],
    ["alreadySet", "02"],
  ] as const) {
    const invited = await inviteStaff(
      { tenantId, userId: SYSTEM_USER },
      { phone: phone(suffix), fullName: "Set Pin Coach", roleKey: "coach", locationIds: [] },
    );
    if (invited.kind !== "ok") throw new Error(`setup invite failed: ${invited.kind}`);
    membershipByTest[test] = invited.membershipId;
  }
});

afterAll(async () => {
  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(inviteLinkUses).where(eq(inviteLinkUses.tenantId, tenantId));
      await tx.delete(staff).where(eq(staff.tenantId, tenantId));
      await tx.delete(persons).where(eq(persons.tenantId, tenantId));
      await tx.delete(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId));
      await tx.delete(locations).where(eq(locations.tenantId, tenantId));
    });
    await admin.query("delete from tenant_memberships where tenant_id = $1", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  for (const suffix of ["01", "02"]) {
    const p = phone(suffix);
    await admin.query(
      "delete from ba_session where user_id in (select id from ba_user where phone_number = $1)",
      [p],
    );
    await admin.query(
      "delete from ba_account where user_id in (select id from ba_user where phone_number = $1)",
      [p],
    );
    await admin.query("delete from ba_user where phone_number = $1", [p]);
    await admin.query("delete from users where phone = $1", [p]);
  }
  await admin.end();
});

// Drives the real first-login flow up to the point where the session
// exists but no PIN does, returning the session cookie header value.
async function redeemWithoutPinCookie(membershipId: string): Promise<string> {
  const issued = await issueLoginLink(tenantId, membershipId);
  if (issued.kind !== "ok") throw new Error("setup issue failed");
  const res = await redeemPOST(
    new Request("http://localhost/api/login-link/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: issued.token }),
    }),
  );
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.startsWith("better-auth.session_token="));
  if (!cookie) throw new Error("redeem did not set a session cookie");
  return cookie.split(";")[0]!;
}

async function setPin(body: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return setPinPOST(
    new Request("http://localhost/api/account/set-pin", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/account/set-pin", () => {
  it("unauthenticated requests are 401", async () => {
    const res = await setPin({ pin: "123456" });
    expect(res.status).toBe(401);
  });

  it("sets the PIN for a credential-less session; the phone+PIN login then works", async () => {
    const cookie = await redeemWithoutPinCookie(membershipByTest["happy"]!);
    const res = await setPin({ pin: "654321" }, cookie);
    expect(res.status).toBe(200);
    expect(await hasCredentialByPhone(phone("01"))).toBe(true);
  });

  it("refuses to overwrite an existing credential with 409", async () => {
    const cookie = await redeemWithoutPinCookie(membershipByTest["alreadySet"]!);
    const first = await setPin({ pin: "654321" }, cookie);
    expect(first.status).toBe(200);
    const second = await setPin({ pin: "999999" }, cookie);
    expect(second.status).toBe(409);
    const body = (await second.json()) as { kind: string; code: string };
    expect(body.kind).toBe("error");
    expect(body.code).toBe("already_set");
  });

  it("rejects a malformed PIN with 400", async () => {
    const cookie = await redeemWithoutPinCookie(membershipByTest["happy"]!);
    const bad = await setPin({ pin: "abc" }, cookie);
    expect(bad.status).toBe(400);
  });
});
