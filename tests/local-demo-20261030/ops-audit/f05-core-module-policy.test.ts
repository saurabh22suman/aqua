// @vitest-environment node
//
// F05 — the six CORE MODULES are mandatory (human decision, 29 October 2026:
// "Keep core modules mandatory and remove misleading switches").
//
// This is the MINIMAL agent-owned regression for the missing half of the
// approved policy, written BEFORE any production change. The combined tree
// carries the RUNTIME policy (lib/auth/permission.ts's ALWAYS_ON_MODULES —
// protected, unchanged) but neither the console nor the server enforces it:
// the entitlement editor still offers a switch for a core module, and the
// server still stores an override row that the runtime ignores.
//
// RED against the current combined source: the override is accepted.
//
// The transferred regressions carry the full contract:
//   * b-08 (the UI half): the set of features without a switch is exactly
//     the runtime's always-on set — derived through requirePermission, not
//     hard-coded.
//   * b-09 (the server half): every intent on a core module is refused,
//     nothing is written, and a stored override is left untouched.
//
// A REAL platform admin session is used (the same shape as the Ops-audit
// suites), so the operation-audit traces the composed policy writes are
// exercised here too: a refusal is recorded as `denied`.
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { sha256 } from "@/db/platform-auth-crypto";
import { provisionPlatformUser } from "@/db/platform-auth";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

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
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

import { upsertTenantFeatureAction } from "@/lib/actions/platform-features";
import { PERMISSIONS } from "@/db/seed-platform";
import { requirePermission } from "@/lib/auth/permission";
import type { Ctx } from "@/lib/auth/context";

const RUN = Date.now().toString(36);
const TENANT_ID = uuidv7();
const TENANT_SLUG = `core-policy-${RUN}`;
const OPTIONAL_KEY = `core-policy-opt-${RUN}`;
let actorId = "";

/** The modules the RUNTIME always keeps on — derived, never assumed. */
function runtimeAlwaysOnModules(): Set<string> {
  const firstPermissionOf = new Map<string, string>();
  for (const permission of PERMISSIONS) {
    if (!firstPermissionOf.has(permission.module)) {
      firstPermissionOf.set(permission.module, permission.key);
    }
  }
  const alwaysOn = new Set<string>();
  for (const [module, permissionKey] of firstPermissionOf) {
    try {
      requirePermission(
        {
          userId: "00000000-0000-4000-8000-000000000001" as Ctx["userId"],
          tenantId: TENANT_ID as Ctx["tenantId"],
          membershipId: "membership",
          roleKey: "owner",
          roleId: "role",
          slug: "core-fixture",
          allLocations: true,
          locationIds: [],
          permissions: new Set([permissionKey]),
          features: new Set<string>(),
        },
        permissionKey,
      );
      alwaysOn.add(module);
    } catch {
      // the runtime refuses it: the module is optional
    }
  }
  return alwaysOn;
}

const ALWAYS_ON = runtimeAlwaysOnModules();

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function readOverride(featureKey: string) {
  const { rows } = await admin.query<{ enabled: boolean }>(
    "select enabled from tenant_features where tenant_id = $1 and feature_key = $2",
    [TENANT_ID, featureKey],
  );
  return rows[0] ?? null;
}

async function operationRows(operation: string, outcome: string) {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from platform_audit_log where actor_id = $1 and action = $2 and detail->>'outcome' = $3",
    [actorId, `ops.operation.${operation}`, outcome],
  );
  return Number(rows[0]!.count);
}

beforeAll(async () => {
  const user = await provisionPlatformUser({
    email: `core-policy-${RUN}@platform.test`,
    name: "Core Policy",
    password: `p-${RUN}`,
    role: "admin",
  });
  actorId = user.id;
  const token = randomBytes(32).toString("hex");
  await admin.query(
    "insert into platform_sessions (id,user_id,token_hash,second_factor_passed,expires_at) values ($1::uuid,$2::uuid,$3,true,$4)",
    [uuidv7(), user.id, sha256(token), new Date(Date.now() + 3600_000)],
  );
  jar.set("platform_session", token);
  await admin.query(
    "insert into tenants(id,slug,name,status) values($1,$2,'Core policy','active')",
    [TENANT_ID, TENANT_SLUG],
  );
  await admin.query(
    "insert into features(key,name,category,status) values($1,$1,'test','ga') on conflict (key) do nothing",
    [OPTIONAL_KEY],
  );
});

afterAll(async () => {
  await admin.query("delete from tenant_features where tenant_id = $1", [
    TENANT_ID,
  ]);
  await admin.query("delete from platform_audit_log where actor_id = $1", [
    actorId,
  ]);
  await admin.query("delete from features where key = $1", [OPTIONAL_KEY]);
  await admin.query("delete from tenants where id = $1", [TENANT_ID]);
  await admin.query(
    "delete from platform_sessions where user_id = $1",
    [actorId],
  );
  await admin.query("delete from platform_users where id = $1", [actorId]);
  await admin.end();
});

describe("the runtime always-on set is discovered, not assumed", () => {
  it("covers exactly six modules", () => {
    expect(ALWAYS_ON.size).toBe(6);
  });
});

describe("F05 — the server refuses a core module", () => {
  it("refuses to force a core module on", async () => {
    const key = [...ALWAYS_ON][0]!;
    const result = await upsertTenantFeatureAction(
      null,
      form({ tenantId: TENANT_ID, featureKey: key, mode: "override", enabled: "true" }),
    );
    expect(result.kind, "forcing a core module on must be refused").toBe("error");
    expect(await readOverride(key)).toBeNull();
  });

  it("refuses to force a core module off", async () => {
    const key = [...ALWAYS_ON][1]!;
    const result = await upsertTenantFeatureAction(
      null,
      form({ tenantId: TENANT_ID, featureKey: key, mode: "override", enabled: "false" }),
    );
    expect(result.kind, "forcing a core module off must be refused").toBe("error");
    expect(await readOverride(key)).toBeNull();
  });

  it("refuses a reset of a core module", async () => {
    const key = [...ALWAYS_ON][2]!;
    const result = await upsertTenantFeatureAction(
      null,
      form({ tenantId: TENANT_ID, featureKey: key, mode: "clear" }),
    );
    expect(result.kind, "resetting a core module must be refused").toBe("error");
  });

  it("refuses a core module whose key only differs by surrounding space", async () => {
    const key = [...ALWAYS_ON][3]!;
    const result = await upsertTenantFeatureAction(
      null,
      form({
        tenantId: TENANT_ID,
        featureKey: ` ${key} `,
        mode: "override",
        enabled: "true",
      }),
    );
    expect(result.kind, "a padded key must not slip past the policy").toBe("error");
    expect(await readOverride(key)).toBeNull();
  });

  it("records the refusal as a denied operation", async () => {
    const key = [...ALWAYS_ON][4]!;
    await upsertTenantFeatureAction(
      null,
      form({ tenantId: TENANT_ID, featureKey: key, mode: "override", enabled: "true" }),
    );
    expect(
      await operationRows("tenant_feature.upsert", "denied"),
      "the refused core-module attempt must be recorded",
    ).toBeGreaterThan(0);
    expect(
      await operationRows("tenant_feature.upsert", "success"),
      "a refused attempt must never be recorded as a success",
    ).toBe(0);
  });
});

describe("F05 — the refusal leaves the optional modules alone", () => {
  it("still forces an optional module on", async () => {
    const result = await upsertTenantFeatureAction(
      null,
      form({ tenantId: TENANT_ID, featureKey: OPTIONAL_KEY, mode: "override", enabled: "true" }),
    );
    expect(result.kind).toBe("ok");
    expect((await readOverride(OPTIONAL_KEY))!.enabled).toBe(true);
  });

  it("still forces an optional module off", async () => {
    const result = await upsertTenantFeatureAction(
      null,
      form({ tenantId: TENANT_ID, featureKey: OPTIONAL_KEY, mode: "override", enabled: "false" }),
    );
    expect(result.kind).toBe("ok");
    expect((await readOverride(OPTIONAL_KEY))!.enabled).toBe(false);
  });
});
