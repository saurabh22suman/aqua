// @vitest-environment node
//
// Packet 03 trace contract (PROPOSAL — the traces are not applied).
//
// Real platform sessions and app role. Nine cases are genuine RED against
// today's source; two are regression guards for behaviour that already holds
// (anonymous writes nothing; the existing feature-clear no-op emits exactly one
// in-transaction noop and no operation success row).
//
// The mandatory-module case of the earlier draft was replaced: it depended on
// the F05/F06 core-module policy, which is a product decision that is NOT part
// of the combined source this packet composes against. The replacement proves
// the same contract — a malformed feature request is recorded under the
// documented family default (tenant_feature.upsert).
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { sha256 } from "@/db/platform-auth-crypto";
import { provisionPlatformUser } from "@/db/platform-auth";

const { jar, faults } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  faults: { auditStore: false },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
    set: (a: { name: string; value: string }) => {
      jar.set(a.name, a.value);
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/db/ops-operation-writer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/ops-operation-writer")>();
  return {
    ...actual,
    appendOpsBoundaryEvent: async (
      ...args: Parameters<typeof actual.appendOpsBoundaryEvent>
    ) => {
      if (faults.auditStore) throw new Error("audit store unavailable");
      return actual.appendOpsBoundaryEvent(...args);
    },
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

import { transitionTenantStatusAction } from "@/lib/actions/platform-tenants";
import { upsertTenantFeatureAction } from "@/lib/actions/platform-features";
import { resolveConfigChangeRequestAction } from "@/lib/actions/platform-config-requests";
import { setTenantTaxRateAction } from "@/lib/actions/platform-tax";
import LeadDetailPage from "@/app/(platform)/ops/leads/[leadId]/page";

const RUN = Date.now().toString(36);
const tenant = uuidv7();
let adminId = "";
let adminToken = "";
let viewerId = "";
let viewerToken = "";

function fd(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

async function sessionFor(role: "admin" | "viewer") {
  const user = await provisionPlatformUser({
    email: `trace-${role}-${RUN}@platform.test`,
    name: `Trace ${role}`,
    password: `p-${role}-${RUN}`,
    role,
  });
  const token = randomBytes(32).toString("hex");
  await admin.query(
    "insert into platform_sessions (id,user_id,token_hash,second_factor_passed,expires_at) values ($1::uuid,$2::uuid,$3,true,$4)",
    [uuidv7(), user.id, sha256(token), new Date(Date.now() + 3600_000)],
  );
  return { id: user.id, token };
}

beforeAll(async () => {
  const adminSession = await sessionFor("admin");
  adminId = adminSession.id;
  adminToken = adminSession.token;
  const viewerSession = await sessionFor("viewer");
  viewerId = viewerSession.id;
  viewerToken = viewerSession.token;
  jar.set("platform_session", adminToken);
  await admin.query(
    "insert into tenants (id,slug,name,status,timezone) values ($1,$2,'Trace Contract','active','Asia/Kolkata')",
    [tenant, `trace-contract-${RUN}`],
  );
});

afterAll(async () => {
  await admin.query("delete from tenant_features where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.query("delete from platform_audit_log where actor_id in (select id from platform_users where email like $1)", [`trace-%-${RUN}@platform.test`]);
  await admin.query("delete from platform_sessions where user_id in (select id from platform_users where email like $1)", [`trace-%-${RUN}@platform.test`]);
  await admin.query("delete from platform_users where email like $1", [`trace-%-${RUN}@platform.test`]);
  await admin.end();
});

async function traces(action: string, outcome: string, actorId: string) {
  const { rows } = await admin.query<{ tenant_id: string | null }>(
    "select tenant_id from platform_audit_log where action = $1 and detail->>'outcome' = $2 and actor_id = $3 and created_at > now() - interval '5 minutes'",
    [action, outcome, actorId],
  );
  return rows;
}

describe("packet 03 trace contract (proposal)", () => {
  it("RED: an authenticated viewer refusal writes one denied row", async () => {
    jar.set("platform_session", viewerToken);
    const target = uuidv7();
    const result = await transitionTenantStatusAction(target, {
      targetStatus: "active",
    });
    expect(result.kind).toBe("error");
    const denied = await traces("ops.operation.tenant.activate", "denied", viewerId);
    expect(
      denied,
      "no denied operation row was written for a viewer refusal",
    ).toHaveLength(1);
    expect(denied[0]!.tenant_id).toBe(target);
  });

  it("RED: an authenticated service failure writes one error row", async () => {
    jar.set("platform_session", adminToken);
    const target = uuidv7();
    const result = await transitionTenantStatusAction(target, {
      targetStatus: "active",
    });
    expect(result.kind).toBe("error");
    const failed = await traces("ops.operation.tenant.activate", "error", adminId);
    expect(
      failed,
      "no error operation row was written for a service failure",
    ).toHaveLength(1);
    expect(failed[0]!.tenant_id).toBe(target);
  });

  it("GUARD: an anonymous mutation writes no operation row", async () => {
    jar.delete("platform_session");
    const count = async () => {
      const { rows } = await admin.query<{ count: string }>(
        "select count(*)::text as count from platform_audit_log where action = $1",
        ["ops.operation.tenant.activate"],
      );
      return Number(rows[0]!.count);
    };
    const before = await count();
    const result = await transitionTenantStatusAction(uuidv7(), {
      targetStatus: "not-a-status",
    });
    expect(result.kind).toBe("error");
    expect(await count()).toBe(before);
  });

  it("RED: a suspended target refusal resolves tenant.suspend", async () => {
    jar.set("platform_session", viewerToken);
    const target = uuidv7();
    const result = await transitionTenantStatusAction(target, {
      targetStatus: "suspended",
    });
    expect(result.kind).toBe("error");
    const denied = await traces("ops.operation.tenant.suspend", "denied", viewerId);
    expect(denied).toHaveLength(1);
    expect(denied[0]!.tenant_id).toBe(target);
  });

  it("RED: a churned target service failure resolves tenant.churn", async () => {
    jar.set("platform_session", adminToken);
    const result = await transitionTenantStatusAction(uuidv7(), {
      targetStatus: "churned",
    });
    expect(result.kind).toBe("error");
    expect(await traces("ops.operation.tenant.churn", "error", adminId)).toHaveLength(1);
  });

  it("RED: a clear-mode service failure resolves tenant_feature.clear", async () => {
    jar.set("platform_session", adminToken);
    const result = await upsertTenantFeatureAction(
      null,
      fd({ tenantId: uuidv7(), featureKey: "reports", mode: "clear" }),
    );
    expect(result.kind).toBe("error");
    expect(
      await traces("ops.operation.tenant_feature.clear", "error", adminId),
    ).toHaveLength(1);
  });

  it("RED: a malformed feature request is logged invalid under the family default", async () => {
    jar.set("platform_session", adminToken);
    const result = await upsertTenantFeatureAction(
      null,
      fd({ tenantId: tenant, featureKey: "reports", mode: "not-a-mode" }),
    );
    expect(result.kind).toBe("error");
    expect(
      await traces("ops.operation.tenant_feature.upsert", "invalid", adminId),
    ).toHaveLength(1);
  });

  it("RED: a config request service failure writes one error row", async () => {
    jar.set("platform_session", adminToken);
    const result = await resolveConfigChangeRequestAction(
      null,
      fd({ requestId: uuidv7(), status: "declined", resolutionNote: "x" }),
    );
    expect(result.ok).toBe(false);
    expect(
      await traces("ops.operation.config.request.resolve", "error", adminId),
    ).toHaveLength(1);
  });

  it("RED: a tax refusal keeps its outcome when the audit store is unavailable", async () => {
    jar.set("platform_session", adminToken);
    faults.auditStore = true;
    try {
      const result = await setTenantTaxRateAction({
        tenantId: uuidv7(),
        scopeType: "tenant",
        rateBp: 12000,
      });
      expect(result).toEqual({
        ok: false,
        error: "Enter a rate between 0% and 100%.",
      });
    } finally {
      faults.auditStore = false;
    }
  });

  it("RED: a malformed lead UUID is logged invalid before the query", async () => {
    jar.set("platform_session", adminToken);
    const raw = `NOT-A-UUID-${RUN}`;
    await expect(
      LeadDetailPage({ params: Promise.resolve({ leadId: raw }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    const found = await traces("ops.operation.lead.detail", "invalid", adminId);
    expect(found).toHaveLength(1);
    expect(found[0]!.tenant_id).toBeNull();
  });

  it("GUARD: the existing feature-clear no-op emits one noop and no success row", async () => {
    jar.set("platform_session", adminToken);
    const result = await upsertTenantFeatureAction(
      null,
      fd({ tenantId: tenant, featureKey: "reports", mode: "clear" }),
    );
    expect(result.kind).toBe("ok");
    const noop = await traces("tenant_feature.clear", "noop", adminId);
    expect(noop).toHaveLength(1);
    expect(noop[0]!.tenant_id).toBe(tenant);
    expect(
      await traces("ops.operation.tenant_feature.clear", "success", adminId),
      "a committed no-op must not also write an operation success row",
    ).toHaveLength(0);
  });
});
