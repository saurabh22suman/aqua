// @vitest-environment node
// Install at tests/ops-security/ops-tax-boundary.test.ts in a disposable DB.
// Intended RED before the proposed patch: the public actions execute but
// the expected operation-audit rows do not exist. Run test files serially.
import { randomBytes } from "node:crypto";
import { v7 as uuid } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
import { sha256 } from "@/db/platform-auth-crypto";
import { getTenantTaxConfigAction, setTenantTaxRateAction } from "@/lib/actions/platform-tax";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const tenantId = uuid();
const actorId = uuid();
const viewerId = uuid();
const tokens = new Map<string, string>();
let start: Date;
const trackedIds = new Set<string>();

type Event = {
  id: string;
  actor_id: string | null;
  tenant_id: string | null;
  action: string;
  detail: { outcome: string; correlationId: string; origin: string };
};

async function events(action: string): Promise<Event[]> {
  // Dedicated serial DB only. Anonymous events have no actor or target;
  // bound by this fixture's start timestamp and its exact operation names.
  const result = await admin.query<Event>(
    `select id, actor_id, tenant_id, action, detail from platform_audit_log
     where action = $1 and created_at >= $2
       and (actor_id = any($3::uuid[]) or actor_id is null)
     order by created_at, id`,
    [action, start, [actorId, viewerId]],
  );
  for (const row of result.rows) trackedIds.add(row.id);
  return result.rows;
}

beforeAll(async () => {
  await admin.query("insert into tenants(id,slug,name,status) values($1,$2,'Audit fixture','active')", [tenantId, `audit-${tenantId}`]);
  for (const [id, role] of [[actorId, "admin"], [viewerId, "viewer"]] as const) {
    await admin.query("insert into platform_users(id,email,name,password_hash,password_salt,role) values($1,$2,'Audit fixture','unused','unused',$3)", [id, `${id}@fixture.invalid`, role]);
    const token = randomBytes(32).toString("hex");
    tokens.set(id, token);
    await admin.query("insert into platform_sessions(user_id,token_hash,second_factor_passed,expires_at) values($1,$2,true,now()+interval '1 hour')", [id, sha256(token)]);
  }
});
beforeEach(async () => {
  cookieJar.clear();
  // Use the database clock to avoid differences between app and DB clocks.
  start = (await admin.query<{ now: Date }>("select clock_timestamp() as now")).rows[0]!.now;
});
afterEach(async () => {
  // Capture fixture events even if the test assertion failed.
  await events("ops.operation.tax.read");
  await events("ops.operation.tax.set");
  if (trackedIds.size) await admin.query("delete from platform_audit_log where id=any($1::uuid[])", [[...trackedIds]]);
  trackedIds.clear();
});
afterAll(async () => {
  await admin.query("delete from platform_sessions where user_id=any($1::uuid[])", [[actorId, viewerId]]);
  await admin.query("delete from platform_users where id=any($1::uuid[])", [[actorId, viewerId]]);
  await admin.query("delete from tenants where id=$1::uuid", [tenantId]);
  cookieJar.clear();
  await admin.end();
});

function expectSafe(row: Event, outcome: string) {
  expect(row.detail).toEqual({ outcome, correlationId: expect.any(String), origin: "server_action" });
  expect(row.detail.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(JSON.stringify(row)).not.toContain("secret-request-body");
}

describe("Ops tax action audit boundary", () => {
  it.each([["admin", actorId], ["viewer", viewerId]] as const)("records an authenticated %s read before returning", async (_role, actor) => {
    cookieJar.set("platform_session", tokens.get(actor)!);
    const result = await getTenantTaxConfigAction(tenantId);
    expect(result).not.toBeNull();
    const rows = await events("ops.operation.tax.read");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: actor, tenant_id: tenantId });
    expectSafe(rows[0]!, "success");
  });

  it("records invalid read input without retaining it", async () => {
    cookieJar.set("platform_session", tokens.get(actorId)!);
    expect(await getTenantTaxConfigAction("secret-request-body")).toBeNull();
    const rows = await events("ops.operation.tax.read");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: actorId, tenant_id: null });
    expectSafe(rows[0]!, "invalid");
  });

  it("withholds an anonymous read without creating an unbounded operation log", async () => {
    expect(await getTenantTaxConfigAction(tenantId)).toBeNull();
    const rows = await events("ops.operation.tax.read");
    expect(rows).toHaveLength(0);
  });

  it("records a viewer mutation denial without changing configuration", async () => {
    cookieJar.set("platform_session", tokens.get(viewerId)!);
    const before = await admin.query<{ count: string }>(
      "select count(*) as count from config_values where tenant_id=$1::uuid", [tenantId],
    );
    const result = await setTenantTaxRateAction({ tenantId, scopeType: "tenant", rateBp: 1800 });
    expect(result.ok).toBe(false);
    const after = await admin.query<{ count: string }>(
      "select count(*) as count from config_values where tenant_id=$1::uuid", [tenantId],
    );
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    const rows = await events("ops.operation.tax.set");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: viewerId, tenant_id: tenantId });
    expectSafe(rows[0]!, "denied");
  });

  it("records malformed mutation input without storing its body", async () => {
    cookieJar.set("platform_session", tokens.get(actorId)!);
    const result = await setTenantTaxRateAction({ tenantId, scopeType: "tenant", rateBp: "secret-request-body" });
    expect(result.ok).toBe(false);
    const rows = await events("ops.operation.tax.set");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: actorId, tenant_id: null });
    expectSafe(rows[0]!, "invalid");
  });
});
