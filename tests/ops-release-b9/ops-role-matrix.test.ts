import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/db/platform-auth-crypto";
import { provisionPlatformUser } from "@/db/platform-auth";
import { seedRoleTemplates } from "@/lib/services/roles";
import { privilegedFixturePool } from "../db/privileged-fixture";

import { updateFeatureAction, upsertTenantFeatureAction } from "@/lib/actions/platform-features";
import { createTenantAction, transitionTenantStatusAction } from "@/lib/actions/platform-tenants";
import { inviteOwnerAction } from "@/lib/actions/platform-invite-owner";
import { removeSampleDataAction } from "@/lib/actions/platform-remove-sample-data";
import { applyPresetAction } from "@/lib/actions/platform-preset-apply";
import { setTenantTaxRateAction, getTenantTaxConfigAction } from "@/lib/actions/platform-tax";
import { resolveConfigChangeRequestAction } from "@/lib/actions/platform-config-requests";
import {
  createLeadAction,
  transitionLeadAction,
  convertLeadAction,
} from "@/lib/actions/platform-leads";
import {
  issueOwnerLoginLinkAction,
  issueOwnerResetLinkAction,
} from "@/lib/actions/platform-login-link";
import {
  sendMockMessageAction,
  injectInboundMessageAction,
} from "@/lib/actions/platform-whatsapp-mock";
import {
  listPlatformActivityAction,
  listKnownActionsAction,
} from "@/lib/actions/platform-activity";

// Executable platform role x action matrix for the Ops control plane.
//
// Every Ops page and every Ops Server Action must authorise ITSELF
// (the repo rule: "layouts are for UI only; every page and every
// server action authorizes itself"). This file asserts that from the
// server side, for every mutating platform action and every read
// action, against every session state the platform can be in:
//
//   anonymous | viewer | suspended admin | expired session |
//   half-authenticated (2FA not passed) | demoted admin->viewer |
//   active admin (POSITIVE CONTROL)
//
// The denial assertion is on the AUTH refusal text, not on "an error
// came back": a zod parse failure and a business failure are
// different things, and a matrix that could not tell them apart would
// pass for the wrong reason.

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { name, value } : undefined;
    },
    set: (arg: { name: string; value: string }) => {
      cookieJar.set(arg.name, arg.value);
    },
  }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));
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

// The privileged fixture pool comes from the sanctioned helper in
// tests/db/ — tests/tier1/no-superuser-on-request-path.test.ts requires
// the privileged credential to be named in exactly one place, so a test
// file that names it has to be allowlisted by path.
const admin = privilegedFixturePool;
const RUN = Date.now().toString(36);

const AUTH_DENIED_READONLY = "Your platform account has read-only access.";
const AUTH_DENIED_SESSION = "Your session has expired. Sign in again.";
const AUTH_DENIAL_MESSAGES = new Set([AUTH_DENIED_READONLY, AUTH_DENIED_SESSION]);

// ---- platform actors -------------------------------------------------

const actors: Record<string, string> = {};

async function createSession(
  userId: string,
  opts: { secondFactorPassed?: boolean; expiresAt?: Date } = {},
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await admin.query(
    `insert into platform_sessions
       (id, user_id, token_hash, second_factor_passed, expires_at)
     values ($1::uuid, $2::uuid, $3, $4, $5)`,
    [
      uuidv7(),
      userId,
      sha256(token),
      opts.secondFactorPassed ?? true,
      opts.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    ],
  );
  return token;
}

// ---- fixtures --------------------------------------------------------

const featureKey = `audit-feature-${RUN}`;
const fixtureTenant = uuidv7();
const fixtureSlug = `audit-tenant-${RUN}`;
const ownerPhone = `+9198${RUN.slice(-8)}`.slice(0, 15);
const cleanupPlatformUsers: string[] = [];

type ActionCase = {
  name: string;
  /** Fresh fixtures + the closure that performs the action. */
  build: () => Promise<() => Promise<unknown>>;
  /** Optional: assert the mutation actually landed (positive control). */
  expectEffect?: () => Promise<void>;
};

function fd(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

beforeAll(async () => {
  const adminUser = await provisionPlatformUser({
    email: `audit-admin-${RUN}@platform.test`,
    name: "Audit Admin",
    password: `audit-password-${RUN}`,
    role: "admin",
  });
  const viewerUser = await provisionPlatformUser({
    email: `audit-viewer-${RUN}@platform.test`,
    name: "Audit Viewer",
    password: `audit-password-${RUN}`,
    role: "viewer",
  });
  const suspendedUser = await provisionPlatformUser({
    email: `audit-suspended-${RUN}@platform.test`,
    name: "Audit Suspended",
    password: `audit-password-${RUN}`,
    role: "admin",
  });
  actors.admin = adminUser.id;
  actors.viewer = viewerUser.id;
  actors.suspended = suspendedUser.id;
  cleanupPlatformUsers.push(adminUser.id, viewerUser.id, suspendedUser.id);
  await admin.query("update platform_users set status = 'suspended' where id = $1", [
    suspendedUser.id,
  ]);

  // The fixture feature is created as "beta", NOT "ga": the platform
  // catalogue seed grants every GA feature to the standard plan, so a GA
  // fixture would be granted to the plan and could then not be deleted
  // (the plan_features FK would block the cleanup).
  await admin.query(
    "insert into features (key, name, category, status) values ($1, $2, 'core', 'beta') on conflict (key) do nothing",
    [featureKey, "Audit Feature"],
  );

  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'Audit Fixture', 'trial')",
    [fixtureTenant, fixtureSlug],
  );
  await seedRoleTemplates(fixtureTenant as never);

  // An owner membership with a phone, so the credential-issuance
  // actions have a valid target.
  const ownerRole = (
    await admin.query<{ id: string }>(
      "select id from roles where tenant_id = $1 and key = 'owner'",
      [fixtureTenant],
    )
  ).rows[0].id;
  const userId = uuidv7();
  await admin.query(
    "insert into users (id, phone) values ($1, $2)",
    [userId, ownerPhone],
  );
  await admin.query(
    "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1, $2, $3, $4, 'active')",
    [uuidv7(), fixtureTenant, userId, ownerRole],
  );
});

afterAll(async () => {
  await admin.query("delete from platform_audit_log where actor_id = any($1)", [
    cleanupPlatformUsers,
  ]);
  await admin.query("delete from platform_sessions where user_id = any($1)", [
    cleanupPlatformUsers,
  ]);
  await admin.query("delete from platform_users where id = any($1)", [
    cleanupPlatformUsers,
  ]);
  await admin.query("delete from tenant_memberships where tenant_id = $1", [
    fixtureTenant,
  ]);
  await admin.query("delete from users where phone = $1", [ownerPhone]);
  await admin.query("delete from role_permissions where tenant_id = $1", [
    fixtureTenant,
  ]);
  await admin.query("delete from roles where tenant_id = $1", [fixtureTenant]);
  await admin.query("delete from tenants where id = $1", [fixtureTenant]);
  await admin.query("delete from plan_features where feature_key = $1", [featureKey]);
  await admin.query("delete from features where key = $1", [featureKey]);
  // The create-tenant positive control may have created a real tenant.
  const created = (
    await admin.query<{ id: string }>(
      "select id from tenants where slug = $1",
      [`audit-created-${RUN}`],
    )
  ).rows;
  for (const tenant of created) {
    await admin.query("delete from platform_audit_log where tenant_id = $1", [
      tenant.id,
    ]);
    await admin.query("delete from role_permissions where tenant_id = $1", [
      tenant.id,
    ]);
    await admin.query("delete from roles where tenant_id = $1", [tenant.id]);
    await admin.query("delete from sessions where tenant_id = $1", [tenant.id]);
    await admin.query("delete from batches where tenant_id = $1", [tenant.id]);
    await admin.query("delete from programs where tenant_id = $1", [tenant.id]);
    await admin.query("delete from locations where tenant_id = $1", [tenant.id]);
    await admin.query("delete from tenants where id = $1", [tenant.id]);
  }
});

// ---- matrix ----------------------------------------------------------

type SessionState = {
  key: string;
  /** The message an auth refusal carries in this state. */
  denial: string;
  /** Install the session cookie for this state (or clear it). */
  install: () => Promise<void>;
};

let memoisedStates: Promise<SessionState[]> | null = null;

async function sessionStates(): Promise<SessionState[]> {
  if (!memoisedStates) memoisedStates = buildSessionStates();
  return memoisedStates;
}

async function buildSessionStates(): Promise<SessionState[]> {
  const adminToken = await createSession(actors.admin);
  const viewerToken = await createSession(actors.viewer);
  const suspendedToken = await createSession(actors.suspended);
  const expiredToken = await createSession(actors.admin, {
    expiresAt: new Date(Date.now() - 60_000),
  });
  const unverifiedToken = await createSession(actors.admin, {
    secondFactorPassed: false,
  });

  // Demotion: the SAME session, created while the actor was an admin,
  // then the actor row's role is changed to viewer. A platform session
  // must follow the current role, not the role it was minted with.
  const demotedActor = await provisionPlatformUser({
    email: `audit-demoted-${RUN}@platform.test`,
    name: "Audit Demoted",
    password: `audit-password-${RUN}`,
    role: "admin",
  });
  cleanupPlatformUsers.push(demotedActor.id);
  const demotedSessionToken = await createSession(demotedActor.id);
  await admin.query("update platform_users set role = 'viewer' where id = $1", [
    demotedActor.id,
  ]);

  return [
    {
      key: "anonymous",
      denial: AUTH_DENIED_SESSION,
      install: async () => {
        cookieJar.clear();
      },
    },
    {
      key: "viewer",
      denial: AUTH_DENIED_READONLY,
      install: async () => {
        cookieJar.set("platform_session", viewerToken);
      },
    },
    {
      key: "suspended-admin",
      denial: AUTH_DENIED_SESSION,
      install: async () => {
        cookieJar.set("platform_session", suspendedToken);
      },
    },
    {
      key: "expired-session",
      denial: AUTH_DENIED_SESSION,
      install: async () => {
        cookieJar.set("platform_session", expiredToken);
      },
    },
    {
      key: "unverified-session",
      denial: AUTH_DENIED_SESSION,
      install: async () => {
        cookieJar.set("platform_session", unverifiedToken);
      },
    },
    {
      key: "demoted-admin-to-viewer",
      denial: AUTH_DENIED_READONLY,
      install: async () => {
        cookieJar.set("platform_session", demotedSessionToken);
      },
    },
    {
      key: "admin-positive-control",
      denial: "",
      install: async () => {
        cookieJar.set("platform_session", adminToken);
      },
    },
  ];
}

type Outcome = "not-denied" | "denied" | "other-error";

async function runAction(fn: () => Promise<unknown>): Promise<{
  outcome: Outcome;
  message: string;
}> {
  try {
    const result = await fn();
    if (result && typeof result === "object") {
      const message =
        (result as { message?: unknown }).message ??
        (result as { error?: unknown }).error;
      if (typeof message === "string" && AUTH_DENIAL_MESSAGES.has(message)) {
        return { outcome: "denied", message };
      }
    }
    return { outcome: "not-denied", message: "" };
  } catch (err) {
    if (err instanceof RedirectSignal) return { outcome: "not-denied", message: "" };
    const message = err instanceof Error ? err.message : String(err);
    if (AUTH_DENIAL_MESSAGES.has(message)) {
      return { outcome: "denied", message };
    }
    return { outcome: "other-error", message };
  }
}

// ---- the cases -------------------------------------------------------

function mutationCases(): ActionCase[] {
  return [
    {
      name: "updateFeatureAction",
      build: async () => async () =>
        updateFeatureAction(null, fd({
          key: featureKey,
          name: "Renamed By Audit",
          category: "core",
          status: "beta",
        })),
      expectEffect: async () => {
        const row = (
          await admin.query<{ name: string; status: string }>(
            "select name, status from features where key = $1",
            [featureKey],
          )
        ).rows[0];
        expect(row.name).toBe("Renamed By Audit");
        expect(row.status).toBe("beta");
      },
    },
    {
      name: "createTenantAction",
      build: async () => async () =>
        createTenantAction(null, fd({
          name: "Audit Created Tenant",
          slug: `audit-created-${RUN}`,
          timezone: "Asia/Kolkata",
          planKey: "standard",
          currency: "INR",
          locationName: "Audit Location",
          locationIsPrimary: "on",
          presetKey: "swimming",
        })),
    },
    {
      name: "upsertTenantFeatureAction",
      build: async () => async () =>
        upsertTenantFeatureAction(null, fd({
          tenantId: fixtureTenant,
          featureKey,
          mode: "override",
          enabled: "true",
        })),
      expectEffect: async () => {
        const row = (
          await admin.query<{ enabled: boolean }>(
            "select enabled from tenant_features where tenant_id = $1 and feature_key = $2",
            [fixtureTenant, featureKey],
          )
        ).rows[0];
        expect(row.enabled).toBe(true);
      },
    },
    {
      name: "transitionTenantStatusAction",
      build: async () => async () =>
        transitionTenantStatusAction(fixtureTenant, {
          targetStatus: "suspended",
          reason: "audit matrix",
        }),
      expectEffect: async () => {
        const row = (
          await admin.query<{ status: string }>(
            "select status from tenants where id = $1",
            [fixtureTenant],
          )
        ).rows[0];
        expect(row.status).toBe("suspended");
        // Restore for the next case.
        await admin.query("update tenants set status = 'trial' where id = $1", [
          fixtureTenant,
        ]);
      },
    },
    {
      name: "inviteOwnerAction",
      build: async () => async () =>
        inviteOwnerAction(null, fd({
          tenantId: fixtureTenant,
          phone: `+9197${RUN.slice(-8)}0001`.slice(0, 15),
          fullName: "Audit Invitee",
        })),
    },
    {
      name: "removeSampleDataAction",
      build: async () => async () =>
        removeSampleDataAction(null, fd({ tenantId: fixtureTenant })),
    },
    {
      name: "applyPresetAction",
      build: async () => async () =>
        applyPresetAction(null, fd({
          tenantId: fixtureTenant,
          featureKey: "audit-no-such-preset",
        })),
    },
    {
      name: "setTenantTaxRateAction",
      build: async () => async () =>
        setTenantTaxRateAction({
          tenantId: fixtureTenant,
          scopeType: "tenant",
          rateBp: 1800,
        }),
    },
    {
      name: "resolveConfigChangeRequestAction",
      build: async () => async () =>
        resolveConfigChangeRequestAction(null, fd({
          requestId: uuidv7(),
          status: "resolved",
          resolutionNote: "audit matrix",
        })),
    },
    {
      name: "createLeadAction",
      build: async () => async () =>
        createLeadAction(null, fd({
          businessName: "Audit Sports Academy",
          contactName: "Audit Contact",
          phone: "+919000000000",
          source: "website",
        })),
    },
    {
      name: "transitionLeadAction",
      build: async () => async () =>
        transitionLeadAction(uuidv7(), { status: "qualified" }),
    },
    {
      name: "convertLeadAction",
      build: async () => async () =>
        convertLeadAction(null, fd({
          leadId: uuidv7(),
          slug: `audit-lead-${RUN}`,
        })),
    },
    {
      name: "issueOwnerLoginLinkAction",
      build: async () => async () =>
        issueOwnerLoginLinkAction({ tenantId: fixtureTenant, phone: ownerPhone }),
    },
    {
      name: "issueOwnerResetLinkAction",
      build: async () => async () =>
        issueOwnerResetLinkAction({ tenantId: fixtureTenant, phone: ownerPhone }),
    },
    {
      name: "sendMockMessageAction",
      build: async () => async () =>
        sendMockMessageAction(null, fd({
          tenantId: fixtureTenant,
          toPhone: "+919000000000",
          body: "audit matrix",
        })),
    },
    {
      name: "injectInboundMessageAction",
      build: async () => async () =>
        injectInboundMessageAction(null, fd({
          tenantId: fixtureTenant,
          fromPhone: "+919000000000",
          body: "audit matrix",
        })),
    },
  ];
}

function readCases(): ActionCase[] {
  return [
    {
      name: "getTenantTaxConfigAction",
      build: async () => async () => getTenantTaxConfigAction(fixtureTenant),
    },
    {
      name: "listPlatformActivityAction",
      build: async () => async () => listPlatformActivityAction({ limit: 5 }),
    },
    {
      name: "listKnownActionsAction",
      build: async () => async () => listKnownActionsAction(),
    },
  ];
}

describe("Ops control plane — role x action matrix (server-side)", () => {
  it("every mutating platform action refuses every non-admin session state", async () => {
    const states = await sessionStates();
    const cases = mutationCases();
    const failures: string[] = [];
    for (const state of states.filter((s) => s.denial !== "")) {
      await state.install();
      for (const testCase of cases) {
        const run = await testCase.build();
        const { outcome, message } = await runAction(run);
        if (outcome !== "denied" || message !== state.denial) {
          failures.push(
            `${testCase.name} @ ${state.key}: expected "${state.denial}", got ${outcome} "${message}"`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("every read platform action refuses every non-authenticated session state", async () => {
    const states = await sessionStates();
    const cases = readCases();
    const failures: string[] = [];
    for (const state of states.filter((s) => s.denial !== "")) {
      await state.install();
      for (const testCase of cases) {
        const run = await testCase.build();
        const { outcome, message } = await runAction(run);
        // The read actions either throw the same "expired" message or
        // return null; both are refusals. The important part is that
        // they are NOT a successful read.
        const refused = outcome === "denied" || (outcome === "not-denied" && message === "");
        if (!refused) {
          failures.push(
            `${testCase.name} @ ${state.key}: expected a refusal, got ${outcome} "${message}"`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("every mutating platform action is allowed for an active admin (positive control)", async () => {
    const states = await sessionStates();
    const adminState = states.find((s) => s.key === "admin-positive-control")!;
    const failures: string[] = [];
    for (const testCase of mutationCases()) {
      await adminState.install();
      const run = await testCase.build();
      const { outcome, message } = await runAction(run);
      if (outcome === "denied") {
        failures.push(`${testCase.name}: an active admin was refused (${message})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("an active admin's mutation actually lands and is audited (positive control)", async () => {
    const states = await sessionStates();
    const adminState = states.find((s) => s.key === "admin-positive-control")!;
    await adminState.install();
    const testCase = mutationCases().find((c) => c.name === "updateFeatureAction")!;
    const run = await testCase.build();
    const { outcome } = await runAction(run);
    expect(outcome).not.toBe("denied");
    await testCase.expectEffect!();
    const audit = (
      await admin.query<{ action: string }>(
        "select action from platform_audit_log where actor_id = $1 and action = 'feature.update'",
        [actors.admin],
      )
    ).rows;
    expect(audit.length).toBeGreaterThan(0);
  });
});
