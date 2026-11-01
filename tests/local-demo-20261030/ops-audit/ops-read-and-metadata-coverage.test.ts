// @vitest-environment node
//
// The READ / PAGE coverage and the METADATA contract of the Ops operation
// boundary.
//
// The acceptance contract asks for three things this file proves at the
// real server entry points, with a real platform session and the real
// database:
//
//   1. every data-bearing Ops page and Ops action writes its operation
//      row(s) — one row per operation, with the outcome "success";
//   2. a VIEWER read is a legitimate operation: it is recorded, and it is
//      not refused;
//   3. the operation row's metadata is ALLOWLISTED: exactly the outcome,
//      an opaque correlation id and the origin — never the raw tenant
//      segment, a phone number, a message body or a request value.
//
// The activity read is NONRECURSIVE: reading the activity view writes
// exactly one activity row, so the reader never chases its own event.
//
// RED against the current tree: none of these pages writes an operation
// row today.
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
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

import OpsOverviewPage from "@/app/(platform)/ops/page";
import OpsFeaturesPage from "@/app/(platform)/ops/features/page";
import OpsLeadsPage from "@/app/(platform)/ops/leads/page";
import OpsTenantsPage from "@/app/(platform)/ops/tenants/page";
import OpsNewTenantPage from "@/app/(platform)/ops/tenants/new/page";
import OpsActivityPage from "@/app/(platform)/ops/activity/page";
import OpsPresetsPage from "@/app/(platform)/ops/presets/page";
import OpsPresetDetailPage from "@/app/(platform)/ops/presets/[key]/page";
import OpsTenantConfigurationPage from "@/app/(platform)/ops/tenants/[tenantId]/configuration/page";
import OpsWhatsappPage from "@/app/(platform)/ops/whatsapp/page";
import TenantDetailLayout from "@/app/(platform)/ops/tenants/[tenantId]/layout";
import TenantDetailPage from "@/app/(platform)/ops/tenants/[tenantId]/page";
import {
  listKnownActionsAction,
  listPlatformActivityAction,
} from "@/lib/actions/platform-activity";
import { listPresets } from "@/db/platform-presets";
import { getEffectiveConfiguration } from "@/db/ops-configuration-view";
import { asTenantId } from "@/lib/ids";

const RUN = Date.now().toString(36);
const tenant = uuidv7();
let adminId = "";
let adminToken = "";
let viewerId = "";
let viewerToken = "";

async function sessionFor(role: "admin" | "viewer") {
  const user = await provisionPlatformUser({
    email: `readop-${role}-${RUN}@platform.test`,
    name: `Read Op ${role}`,
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
    "insert into tenants (id,slug,name,status,timezone) values ($1,$2,'Read Ops','active','Asia/Kolkata')",
    [tenant, `read-ops-${RUN}`],
  );
});

afterAll(async () => {
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.query(
    "delete from platform_audit_log where actor_id in (select id from platform_users where email like $1)",
    [`readop-%-${RUN}@platform.test`],
  );
  await admin.query(
    "delete from platform_sessions where user_id in (select id from platform_users where email like $1)",
    [`readop-%-${RUN}@platform.test`],
  );
  await admin.query("delete from platform_users where email like $1", [
    `readop-%-${RUN}@platform.test`,
  ]);
  await admin.end();
});

type Row = {
  action: string;
  tenant_id: string | null;
  detail: Record<string, unknown>;
};

async function rowsFor(actorId: string, operation: string) {
  const { rows } = await admin.query<Row>(
    "select action, tenant_id, detail from platform_audit_log where actor_id = $1 and action = $2",
    [actorId, `ops.operation.${operation}`],
  );
  return rows;
}

// The count of rows an operation has RIGHT NOW. Every assertion below is
// a DELTA across one call: the suites share one actor, so an absolute
// count would also count the rows the earlier cases wrote.
async function countFor(actorId: string, operation: string) {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from platform_audit_log where actor_id = $1 and action = $2",
    [actorId, `ops.operation.${operation}`],
  );
  return Number(rows[0]!.count);
}

const PAGES: { name: string; operations: string[]; call: () => Promise<unknown> }[] =
  [
    {
      name: "overview",
      operations: [
        "platform.metrics.summary",
        "tenant.health.queue",
        "activity.list",
      ],
      call: () => OpsOverviewPage(),
    },
    {
      name: "features",
      operations: ["feature.catalogue.list"],
      call: () => OpsFeaturesPage(),
    },
    {
      name: "leads",
      operations: ["lead.list"],
      call: () => OpsLeadsPage({ searchParams: Promise.resolve({}) }),
    },
    {
      name: "tenants",
      operations: ["tenant.list", "plan.list", "preset.list"],
      call: () => OpsTenantsPage({ searchParams: Promise.resolve({}) }),
    },
    {
      name: "presets",
      operations: ["preset.list", "preset.preview"],
      call: () => OpsPresetsPage(),
    },
    {
      name: "whatsapp",
      operations: ["message.list", "tenant.list"],
      call: () => OpsWhatsappPage(),
    },
    {
      name: "tenant detail layout",
      operations: ["tenant.header"],
      call: () =>
        TenantDetailLayout({
          params: Promise.resolve({ tenantId: tenant }),
          children: null,
        }),
    },
    {
      name: "tenant detail page",
      operations: ["tenant.detail", "tenant.sample_data.state"],
      call: () =>
        TenantDetailPage({ params: Promise.resolve({ tenantId: tenant }) }),
    },
    {
      name: "new tenant",
      operations: ["plan.list", "preset.list"],
      call: () => OpsNewTenantPage(),
    },
    {
      name: "activity",
      operations: ["activity.list", "activity.actions.list", "tenant.selector.list"],
      call: () => OpsActivityPage({ searchParams: Promise.resolve({}) }),
    },
  ];

describe("every data-bearing Ops page records its operation", () => {
  it.each(PAGES)(
    "$name: one success row per operation",
    async ({ operations, call }) => {
      jar.set("platform_session", adminToken);
      const before = new Map<string, number>();
      for (const operation of operations) {
        before.set(operation, await countFor(adminId, operation));
      }
      await call();
      for (const operation of operations) {
        const found = await rowsFor(adminId, operation);
        const written = found.length - (before.get(operation) ?? 0);
        expect(
          written,
          `no operation row was written for ${operation}`,
        ).toBe(1);
        expect(found[found.length - 1]!.detail.outcome).toBe("success");
      }
    },
  );
});

describe("the conditional reads are recorded too", () => {
  it("the preset detail page records preset.detail and location.list", async () => {
    const presets = await listPresets();
    const active = presets.find((preset) => preset.status === "active");
    // A missing precondition is a FAILURE, never a silent skip: the
    // seeded platform catalogue always has an active preset.
    expect(
      active?.key,
      "the seeded catalogue must have an active preset",
    ).toBeTruthy();
    const key = active?.key ?? "";
    jar.set("platform_session", adminToken);
    const before = new Map<string, number>();
    for (const operation of ["preset.detail", "preset.preview", "tenant.list", "location.list"]) {
      before.set(operation, await countFor(adminId, operation));
    }
    await OpsPresetDetailPage({ params: Promise.resolve({ key }) });
    for (const operation of ["preset.detail", "preset.preview", "tenant.list", "location.list"]) {
      const found = await rowsFor(adminId, operation);
      expect(
        found.length - (before.get(operation) ?? 0),
        `no operation row was written for ${operation}`,
      ).toBe(1);
    }
  });

  it("the configuration page records the chain and audit reads when a key is selected", async () => {
    const view = await getEffectiveConfiguration(asTenantId(tenant));
    // A missing precondition is a FAILURE, never a silent skip: every
    // tenant resolves the whole config registry.
    expect(view, "the tenant must have an effective configuration").not.toBeNull();
    const configKey = view?.config[0]?.key ?? "";
    expect(
      configKey,
      "the config registry must resolve at least one key",
    ).toBeTruthy();
    jar.set("platform_session", adminToken);
    const before = new Map<string, number>();
    for (const operation of [
      "config.effective.read",
      "config.request.list",
      "config.chain.resolve",
      "config.audit.list",
      "tenant.selector.list",
    ]) {
      before.set(operation, await countFor(adminId, operation));
    }
    await OpsTenantConfigurationPage({
      params: Promise.resolve({ tenantId: tenant }),
      searchParams: Promise.resolve({ key: configKey }),
    });
    for (const operation of [
      "config.effective.read",
      "config.request.list",
      "config.chain.resolve",
      "config.audit.list",
      "tenant.selector.list",
    ]) {
      const found = await rowsFor(adminId, operation);
      expect(
        found.length - (before.get(operation) ?? 0),
        `no operation row was written for ${operation}`,
      ).toBe(1);
    }
  });
});

describe("the Ops actions record their operations", () => {
  it("listPlatformActivityAction writes exactly one activity row (no recursion)", async () => {
    jar.set("platform_session", adminToken);
    const before = await countFor(adminId, "activity.list");
    await listPlatformActivityAction({ limit: 5 });
    const after = await countFor(adminId, "activity.list");
    expect(
      after - before,
      "the activity reader must not call itself recursively",
    ).toBe(1);
    const found = await rowsFor(adminId, "activity.list");
    expect(found[found.length - 1]!.detail.outcome).toBe("success");
  });

  it("listKnownActionsAction writes one activity.actions.list row", async () => {
    jar.set("platform_session", adminToken);
    const before = await countFor(adminId, "activity.actions.list");
    await listKnownActionsAction();
    const after = await countFor(adminId, "activity.actions.list");
    expect(after - before).toBe(1);
    const found = await rowsFor(adminId, "activity.actions.list");
    expect(found[found.length - 1]!.detail.outcome).toBe("success");
  });
});

describe("a viewer read is a legitimate operation", () => {
  it("the feature catalogue read is recorded for a viewer", async () => {
    jar.set("platform_session", viewerToken);
    const before = await countFor(viewerId, "feature.catalogue.list");
    await OpsFeaturesPage();
    const after = await countFor(viewerId, "feature.catalogue.list");
    expect(after - before, "a viewer read must still be recorded").toBe(1);
  });
});

describe("the operation metadata is allowlisted", () => {
  it("a row carries the outcome, an opaque correlation id and the origin — nothing else", async () => {
    jar.set("platform_session", adminToken);
    const before = await countFor(adminId, "tenant.list");
    await OpsTenantsPage({ searchParams: Promise.resolve({ search: "acme" }) });
    const found = await rowsFor(adminId, "tenant.list");
    expect(found.length - before).toBe(1);
    const row = found[found.length - 1]!;
    expect(Object.keys(row.detail).sort()).toEqual([
      "correlationId",
      "origin",
      "outcome",
    ]);
    expect(row.detail.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(
      JSON.stringify(row.detail),
      "the operation row must not carry the request value the operator typed",
    ).not.toContain("acme");
  });
});
