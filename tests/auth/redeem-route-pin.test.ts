// @vitest-environment node
//
// Slice 5 — POST /api/login-link/redeem accepts an optional PIN.
//
// Route-level test: imports the route's POST handler and calls it
// with a real Request, so the Set-Cookie forwarding and status codes
// are exercised end to end (the service tests in slice 4 cover the
// underlying logic).

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
import { POST } from "@/app/api/login-link/redeem/route";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const RUN_NUM = Date.now() % 1000000;
const phone = (suffix: string) => `+91990${RUN_NUM}${suffix}`;

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
const membershipByTest: Record<string, string> = {};

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = (
    await admin.query<{ id: string }>("select id from plans where is_default = true limit 1")
  ).rows[0];
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Redeem Route Test', $3, 'Asia/Kolkata')",
    [tenantId, `redeem-route-${RUN}`, plan?.id ?? null],
  );
  await withTenant(tenantId, async (tx) => {
    await tx.insert(locations).values({ tenantId, name: "Main", isPrimary: true });
  });
  await seedRoleTemplates(tenantId);
  for (const [test, suffix] of [
    ["pin", "01"],
    ["noPin", "02"],
    ["badPin", "03"],
    ["singleUse", "04"],
  ] as const) {
    const invited = await inviteStaff(
      { tenantId, userId: SYSTEM_USER },
      { phone: phone(suffix), fullName: "Route Coach", roleKey: "coach", locationIds: [] },
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
  for (const suffix of ["01", "02", "03", "04"]) {
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

async function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/login-link/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/login-link/redeem", () => {
  it("with a PIN: 200, session cookie set, credential persisted", async () => {
    const issued = await issueLoginLink(tenantId, membershipByTest["pin"]!);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const res = await post({ token: issued.token, pin: "123456" });
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("better-auth.session_token="))).toBe(true);
    const body = (await res.json()) as { kind: string; homePath: string };
    expect(body.kind).toBe("ok");
    expect(body.homePath).toBe("/coach");
    expect(await hasCredentialByPhone(phone("01"))).toBe(true);
  });

  it("without a PIN on a credential-less membership: 200 with homePath /set-pin", async () => {
    const issued = await issueLoginLink(tenantId, membershipByTest["noPin"]!);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const res = await post({ token: issued.token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; homePath: string };
    expect(body.kind).toBe("ok");
    expect(body.homePath).toBe("/set-pin");
  });

  it("a malformed PIN is a 400 and does not consume the link", async () => {
    const issued = await issueLoginLink(tenantId, membershipByTest["badPin"]!);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const bad = await post({ token: issued.token, pin: "abc" });
    expect(bad.status).toBe(400);

    const good = await post({ token: issued.token, pin: "123456" });
    expect(good.status).toBe(200);
  });

  it("a consumed link is refused with 401", async () => {
    const issued = await issueLoginLink(tenantId, membershipByTest["singleUse"]!);
    if (issued.kind !== "ok") throw new Error("setup issue failed");
    const first = await post({ token: issued.token, pin: "123456" });
    expect(first.status).toBe(200);
    const second = await post({ token: issued.token, pin: "123456" });
    expect(second.status).toBe(401);
  });
});
