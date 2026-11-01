// @vitest-environment node
//
// THE THROWN MUTATION PATHS — the gap the frozen successor packet left
// open, and the reason this file exists.
//
// The packet's mutation-refusal diff traces a mutation that RETURNS a
// refusal (invalid / denied / a returned service failure). It traced one
// raised failure only: tax.set. Every other mutating Ops action could
// still RAISE out of the service with NO operation row at all, so the
// operation was invisible to an operator reading the audit trail.
//
// For every mutating Ops action this file proves, at the real server
// entry point with a real platform session and the real database:
//
//   1. a raised service writes exactly ONE operation row, with outcome
//      "error";
//   2. the ORIGINAL error is rethrown (the trace never replaces the
//      caller's error, and never turns a refusal into an exception);
//   3. no row claims the mutation committed — no "success" operation row
//      and no domain audit row;
//   4. a permission refusal raised INSIDE the audited pipeline is
//      recorded as "denied", not as an unexpected failure.
//
// RED against the current tree: the raised path writes no row at all.
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { sha256 } from "@/db/platform-auth-crypto";
import { provisionPlatformUser } from "@/db/platform-auth";

const { jar, faults, state } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  faults: { service: false, guardRace: false },
  state: { viewerId: "" },
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
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

const BOOM = "SERVICE_RAISED";

// The service seam. Every mutating service below is wrapped so the test
// can make it RAISE. Nothing else about the service changes: the real
// transaction, the real audit writer and the real platform session stay.
function raising<F extends (...args: never[]) => unknown>(actual: F): F {
  const wrapped = async (...args: unknown[]) => {
    if (faults.service) throw new Error(BOOM);
    return (actual as unknown as (...a: unknown[]) => unknown)(...args);
  };
  return wrapped as unknown as F;
}

vi.mock("@/db/platform-tenant-create", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/platform-tenant-create")>();
  return { ...actual, createTenant: raising(actual.createTenant) };
});
vi.mock("@/db/platform-tenant-status", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/platform-tenant-status")>();
  return { ...actual, transitionTenantStatus: raising(actual.transitionTenantStatus) };
});
vi.mock("@/db/tenant-invite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/tenant-invite")>();
  return { ...actual, inviteOwner: raising(actual.inviteOwner) };
});
vi.mock("@/lib/services/invite-link", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/invite-link")>();
  return {
    ...actual,
    issueLoginLinkForPhone: raising(actual.issueLoginLinkForPhone),
    issueOwnerResetLinkForPhone: raising(actual.issueOwnerResetLinkForPhone),
  };
});
vi.mock("@/db/preset-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/preset-engine")>();
  return { ...actual, applyPreset: raising(actual.applyPreset) };
});
vi.mock("@/db/preset-sample-data", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/preset-sample-data")>();
  return { ...actual, removeSampleData: raising(actual.removeSampleData) };
});
vi.mock("@/db/platform-features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/platform-features")>();
  return { ...actual, updateFeature: raising(actual.updateFeature) };
});
vi.mock("@/db/platform-tenant-features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/platform-tenant-features")>();
  return { ...actual, upsertTenantFeature: raising(actual.upsertTenantFeature) };
});
vi.mock("@/db/config-requests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/config-requests")>();
  return {
    ...actual,
    resolveConfigChangeRequest: raising(actual.resolveConfigChangeRequest),
  };
});
vi.mock("@/db/platform-leads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/platform-leads")>();
  return {
    ...actual,
    createLead: raising(actual.createLead),
    transitionLead: raising(actual.transitionLead),
  };
});
vi.mock("@/db/platform-lead-conversion", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/platform-lead-conversion")>();
  return { ...actual, convertLead: raising(actual.convertLead) };
});
vi.mock("@/lib/messaging/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/messaging/send")>();
  return { ...actual, sendMessage: raising(actual.sendMessage) };
});
vi.mock("@/lib/messaging/inbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/messaging/inbound")>();
  return { ...actual, handleInboundMessage: raising(actual.handleInboundMessage) };
});
vi.mock("@/db/config-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/config-admin")>();
  return {
    ...actual,
    setPlatformScopedConfigValue: raising(actual.setPlatformScopedConfigValue),
  };
});

// The guard race: the action's own session check says "admin", but the
// actor row db/ops-action re-reads inside the pipeline says "viewer". The
// pipeline refuses BEFORE the service runs. That refusal is a DENIAL.
vi.mock("@/lib/actions/platform-auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/actions/platform-auth")>();
  return {
    ...actual,
    requireOpsAdminAction: async () => {
      if (faults.guardRace) {
        return { kind: "ok", userId: state.viewerId, role: "admin" } as const;
      }
      return actual.requireOpsAdminAction();
    },
  };
});

import { createTenantAction, transitionTenantStatusAction } from "@/lib/actions/platform-tenants";
import { inviteOwnerAction } from "@/lib/actions/platform-invite-owner";
import {
  issueOwnerLoginLinkAction,
  issueOwnerResetLinkAction,
} from "@/lib/actions/platform-login-link";
import { applyPresetAction } from "@/lib/actions/platform-preset-apply";
import { removeSampleDataAction } from "@/lib/actions/platform-remove-sample-data";
import {
  updateFeatureAction,
  upsertTenantFeatureAction,
} from "@/lib/actions/platform-features";
import { resolveConfigChangeRequestAction } from "@/lib/actions/platform-config-requests";
import {
  convertLeadAction,
  createLeadAction,
  transitionLeadAction,
} from "@/lib/actions/platform-leads";
import {
  injectInboundMessageAction,
  sendMockMessageAction,
} from "@/lib/actions/platform-whatsapp-mock";
import { setTenantTaxRateAction } from "@/lib/actions/platform-tax";

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
    email: `thrown-${role}-${RUN}@platform.test`,
    name: `Thrown ${role}`,
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
  state.viewerId = viewerId;
  jar.set("platform_session", adminToken);
  await admin.query(
    "insert into tenants (id,slug,name,status,timezone) values ($1,$2,'Thrown Paths','active','Asia/Kolkata')",
    [tenant, `thrown-paths-${RUN}`],
  );
});

afterAll(async () => {
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.query(
    "delete from platform_audit_log where actor_id in (select id from platform_users where email like $1)",
    [`thrown-%-${RUN}@platform.test`],
  );
  await admin.query(
    "delete from platform_sessions where user_id in (select id from platform_users where email like $1)",
    [`thrown-%-${RUN}@platform.test`],
  );
  await admin.query("delete from platform_users where email like $1", [
    `thrown-%-${RUN}@platform.test`,
  ]);
  await admin.end();
});

type Row = {
  action: string;
  tenant_id: string | null;
  detail: Record<string, unknown>;
};

async function rowsFor(actorId: string, action: string, outcome: string) {
  const { rows } = await admin.query<Row>(
    "select action, tenant_id, detail from platform_audit_log where actor_id = $1 and action = $2 and detail->>'outcome' = $3",
    [actorId, action, outcome],
  );
  return rows;
}

type Case = {
  name: string;
  operation: string;
  domainAction: string;
  tenantId: string | null;
  call: () => Promise<unknown>;
};

const CASES: Case[] = [
  {
    name: "tenant.create",
    operation: "tenant.create",
    domainAction: "tenant.create",
    tenantId: null,
    call: () =>
      createTenantAction(
        null,
        fd({
          name: "Raised Tenant",
          slug: `raised-${RUN}`,
          timezone: "Asia/Kolkata",
          planKey: "starter",
          currency: "INR",
          locationName: "Raised Location",
          locationIsPrimary: "on",
          presetKey: "start-from-scratch",
        }),
      ),
  },
  {
    name: "tenant.activate",
    operation: "tenant.activate",
    domainAction: "tenant.activate",
    tenantId: tenant,
    call: () => transitionTenantStatusAction(tenant, { targetStatus: "active" }),
  },
  {
    name: "tenant.suspend",
    operation: "tenant.suspend",
    domainAction: "tenant.suspend",
    tenantId: tenant,
    call: () =>
      transitionTenantStatusAction(tenant, { targetStatus: "suspended" }),
  },
  {
    name: "tenant.churn",
    operation: "tenant.churn",
    domainAction: "tenant.churn",
    tenantId: tenant,
    call: () => transitionTenantStatusAction(tenant, { targetStatus: "churned" }),
  },
  {
    name: "tenant.invite_owner",
    operation: "tenant.invite_owner",
    domainAction: "tenant.invite_owner",
    tenantId: tenant,
    call: () =>
      inviteOwnerAction(
        null,
        fd({
          tenantId: tenant,
          phone: "9800000000",
          fullName: "Raised Owner",
          staffType: "coach",
        }),
      ),
  },
  {
    name: "tenant.owner_login_link.issue",
    operation: "tenant.owner_login_link.issue",
    domainAction: "tenant.owner_login_link.issue",
    tenantId: tenant,
    call: () =>
      issueOwnerLoginLinkAction({ tenantId: tenant, phone: "9800000000" }),
  },
  {
    name: "tenant.owner_reset_link.issue",
    operation: "tenant.owner_reset_link.issue",
    domainAction: "tenant.owner_reset_link.issue",
    tenantId: tenant,
    call: () =>
      issueOwnerResetLinkAction({ tenantId: tenant, phone: "9800000000" }),
  },
  {
    name: "tenant.preset.apply",
    operation: "tenant.preset.apply",
    domainAction: "tenant.preset.apply",
    tenantId: tenant,
    call: () =>
      applyPresetAction(
        null,
        fd({ tenantId: tenant, featureKey: "start-from-scratch" }),
      ),
  },
  {
    name: "tenant.remove_sample_data",
    operation: "tenant.remove_sample_data",
    domainAction: "tenant.remove_sample_data",
    tenantId: tenant,
    call: () => removeSampleDataAction(null, fd({ tenantId: tenant })),
  },
  {
    name: "feature.update",
    operation: "feature.update",
    domainAction: "feature.update",
    tenantId: null,
    call: () =>
      updateFeatureAction(
        null,
        fd({
          key: "reports",
          name: "Reports",
          category: "ops",
          status: "ga",
        }),
      ),
  },
  {
    name: "tenant_feature.upsert",
    operation: "tenant_feature.upsert",
    domainAction: "tenant_feature.upsert",
    tenantId: tenant,
    call: () =>
      upsertTenantFeatureAction(
        null,
        fd({
          tenantId: tenant,
          featureKey: "reports",
          mode: "override",
          enabled: "true",
        }),
      ),
  },
  {
    name: "tenant_feature.clear",
    operation: "tenant_feature.clear",
    domainAction: "tenant_feature.clear",
    tenantId: tenant,
    call: () =>
      upsertTenantFeatureAction(
        null,
        fd({ tenantId: tenant, featureKey: "reports", mode: "clear" }),
      ),
  },
  {
    name: "config.request.resolve",
    operation: "config.request.resolve",
    domainAction: "config.request.resolve",
    tenantId: null,
    call: () =>
      resolveConfigChangeRequestAction(
        null,
        fd({
          requestId: uuidv7(),
          status: "declined",
          resolutionNote: "raised",
        }),
      ),
  },
  {
    name: "platform_lead.create",
    operation: "platform_lead.create",
    domainAction: "platform_lead.create",
    tenantId: null,
    call: () =>
      createLeadAction(
        null,
        fd({
          businessName: "Raised Academy",
          contactName: "Raised Contact",
          phone: "9800000000",
          source: "website",
        }),
      ),
  },
  {
    name: "platform_lead.update",
    operation: "platform_lead.update",
    domainAction: "platform_lead.update",
    tenantId: null,
    call: () =>
      transitionLeadAction(uuidv7(), { status: "qualified" }),
  },
  {
    name: "platform_lead.convert",
    operation: "platform_lead.convert",
    domainAction: "platform_lead.convert",
    tenantId: null,
    call: () =>
      convertLeadAction(
        null,
        fd({ leadId: uuidv7(), slug: `raised-lead-${RUN}` }),
      ),
  },
  {
    name: "message.send",
    operation: "message.send",
    domainAction: "message.send",
    tenantId: tenant,
    call: () =>
      sendMockMessageAction(
        null,
        fd({
          tenantId: tenant,
          toPhone: "9800000000",
          body: "raised body",
        }),
      ),
  },
  {
    name: "message.inbound",
    operation: "message.inbound",
    domainAction: "message.inbound",
    tenantId: tenant,
    call: () =>
      injectInboundMessageAction(
        null,
        fd({
          tenantId: tenant,
          fromPhone: "9800000000",
          body: "raised body",
        }),
      ),
  },
  {
    name: "tax.set",
    operation: "tax.set",
    domainAction: "config.set",
    tenantId: tenant,
    call: () =>
      setTenantTaxRateAction({
        tenantId: tenant,
        scopeType: "tenant",
        rateBp: 1800,
      }),
  },
];

describe("a raised mutation is recorded and the original error survives", () => {
  it.each(CASES)(
    "$name: one error row, the original error rethrown, nothing claims a commit",
    async ({ operation, domainAction, tenantId, call }) => {
      jar.set("platform_session", adminToken);
      faults.service = true;
      try {
        await expect(call()).rejects.toThrow(BOOM);
      } finally {
        faults.service = false;
      }

      const failed = await rowsFor(adminId, `ops.operation.${operation}`, "error");
      expect(
        failed,
        `no error operation row was written for ${operation}`,
      ).toHaveLength(1);
      expect(failed[0]!.tenant_id).toBe(tenantId);
      expect(
        failed[0]!.detail,
        "the operation row must carry an opaque correlation id and nothing else",
      ).toEqual({
        outcome: "error",
        correlationId: expect.any(String),
        origin: "server_action",
      });

      expect(
        await rowsFor(adminId, `ops.operation.${operation}`, "success"),
        "a failed operation must never also claim a success",
      ).toHaveLength(0);
      const { rows: domainRows } = await admin.query<Row>(
        "select action, tenant_id, detail from platform_audit_log where actor_id = $1 and action = $2",
        [adminId, domainAction],
      );
      expect(
        domainRows,
        "a raised service must not leave a domain audit row that claims a commit",
      ).toHaveLength(0);
    },
  );
});

describe("a permission refusal inside the pipeline is a denial, not a failure", () => {
  it("tenant.create: the pipeline's refusal is recorded as denied and rethrown", async () => {
    jar.set("platform_session", viewerToken);
    faults.guardRace = true;
    try {
      await expect(
        createTenantAction(
          null,
          fd({
            name: "Denied Tenant",
            slug: `denied-${RUN}`,
            timezone: "Asia/Kolkata",
            planKey: "starter",
            currency: "INR",
            locationName: "Denied Location",
            locationIsPrimary: "on",
            presetKey: "start-from-scratch",
          }),
        ),
      ).rejects.toThrow(/forbidden/);
    } finally {
      faults.guardRace = false;
    }

    const denied = await rowsFor(viewerId, "ops.operation.tenant.create", "denied");
    expect(
      denied,
      "the pipeline's refusal was not recorded as a denial",
    ).toHaveLength(1);
    expect(
      await rowsFor(viewerId, "ops.operation.tenant.create", "error"),
      "a permission refusal must not be recorded as an unexpected failure",
    ).toHaveLength(0);
  });
});
