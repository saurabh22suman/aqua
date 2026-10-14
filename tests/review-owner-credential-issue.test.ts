// @vitest-environment node
//
// A06 — Owner credential issuance authority regression
// (docs/audits/2026-10-09-role-content-permission-audit.md).
//
// An issuer may mint login / reset / relogin bearer credentials only for
// targets at or below the issuer's trust level: Owner (ordinal 0) may
// target Owner; Administrator (ordinal 1) must NOT target Owner, but may
// target lower-trust staff. This applies to both bearer flows:
//   - the Owner-reset path (lib/actions/tenant-owner-reset.ts +
//     lib/services/owner-reset.ts), and
//   - ordinary relogin issuance for an existing active user
//     (lib/actions/invite-link.ts + lib/services/invite-link-issue.ts).
//
// The target's ACTUAL active membership role decides, not a supplied
// label. On denial: no token, no audit, no notification enqueue. On
// allowed issuance: a dedicated security audit row without the token and
// the existing expiry semantics.
//
// Harness: real Postgres 16 container (bootstrapRoles -> runMigrations ->
// seedPlatformCatalogue) with synthetic users/memberships; actions are
// invoked directly with a context whose permission set is read from
// role_permissions (tests/review-resource-integrity.test.ts pattern plus
// the context-mock pattern from tests/review-action-scopes.test.ts).
//
// First run is deliberately red: an Administrator context can currently
// mint an Owner reset and relogin token.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  asTenantId,
  asUserId,
  type TenantId,
  type UserId,
} from "@/lib/ids";

const mocks = vi.hoisted(() => ({ ctx: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: mocks.ctx,
  NotFoundError: class extends Error {},
}));

type TestCtx = {
  tenantId: TenantId;
  userId: UserId;
  roleKey: string;
  allLocations: boolean;
  locationIds: string[];
  permissions: Set<string>;
  features: Set<string>;
  requestId: string;
};

let container: StartedPostgreSqlContainer;
let admin: Pool;
let tenantId: TenantId;
let otherTenantId: TenantId;
let ownerUserId: UserId;
let adminUserId: UserId;
let adminCtx: TestCtx;
let ownerCtx: TestCtx;
let ownerMembershipId: string;
let coachMembershipId: string;
let revokedOwnerMembershipId: string;
let otherOwnerMembershipId: string;
// A06 sibling (resend): invited targets whose credential a resend would
// materialise through the outbox.
let invitedOwnerMembershipId: string;
let invitedOwner2MembershipId: string;
let invitedCoachMembershipId: string;

let ownerReset: typeof import("@/lib/services/owner-reset");
let inviteActions: typeof import("@/lib/actions/invite-link");
let staffInviteActions: typeof import("@/lib/actions/staff-invitations");
let tokenCodec: typeof import("@/lib/services/invite-link-token");

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = `postgresql://app_login:review-tests@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = "review-tests";
  process.env.BETTER_AUTH_SECRET = "review-tests-secret";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PARENT_LINK_SECRET = "review-tests-secret";

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(url, "review-tests");
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(url);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(url);
  admin = new Pool({ connectionString: url });

  tenantId = asTenantId(randomUUID());
  otherTenantId = asTenantId(randomUUID());
  ownerUserId = asUserId(randomUUID());
  adminUserId = asUserId(randomUUID());
  const coachUserId = asUserId(randomUUID());
  const revokedOwnerUserId = asUserId(randomUUID());
  const otherOwnerUserId = asUserId(randomUUID());
  const invitedOwnerUserId = asUserId(randomUUID());
  const invitedOwner2UserId = asUserId(randomUUID());
  const invitedCoachUserId = asUserId(randomUUID());

  await admin.query(
    "insert into tenants(id,slug,name,status) values($1,$2,'Owner credential A','active'),($3,$4,'Owner credential B','active')",
    [
      tenantId,
      `owner-credential-a-${tenantId}`,
      otherTenantId,
      `owner-credential-b-${otherTenantId}`,
    ],
  );
  await admin.query(
    `insert into users(id,phone) values
       ($1,'+919900002001'),($2,'+919900002002'),($3,'+919900002003'),
       ($4,'+919900002004'),($5,'+919900002005'),($6,'+919900002006'),
       ($7,'+919900002007'),($8,'+919900002008')`,
    [
      ownerUserId,
      adminUserId,
      coachUserId,
      revokedOwnerUserId,
      otherOwnerUserId,
      invitedOwnerUserId,
      invitedOwner2UserId,
      invitedCoachUserId,
    ],
  );

  ownerReset = await import("@/lib/services/owner-reset");
  const roles = await import("@/lib/services/roles");
  await roles.seedRoleTemplates(tenantId);
  await roles.seedRoleTemplates(otherTenantId);

  const roleId = async (tid: TenantId, key: string): Promise<string> => {
    const { rows } = await admin.query<{ id: string }>(
      "select id from roles where tenant_id=$1 and key=$2",
      [tid, key],
    );
    if (!rows[0]) throw new Error(`missing seeded role ${key}`);
    return rows[0].id;
  };
  const mkMembership = async (
    tid: TenantId,
    key: string,
    userId: UserId,
    status: "active" | "revoked" | "invited",
  ): Promise<string> => {
    const id = randomUUID();
    await admin.query(
      "insert into tenant_memberships(id,tenant_id,user_id,role_id,status) values($1,$2,$3,$4,$5)",
      [id, tid, userId, await roleId(tid, key), status],
    );
    return id;
  };

  ownerMembershipId = await mkMembership(tenantId, "owner", ownerUserId, "active");
  await mkMembership(tenantId, "admin", adminUserId, "active");
  coachMembershipId = await mkMembership(tenantId, "coach", coachUserId, "active");
  revokedOwnerMembershipId = await mkMembership(
    tenantId,
    "owner",
    revokedOwnerUserId,
    "revoked",
  );
  otherOwnerMembershipId = await mkMembership(
    otherTenantId,
    "owner",
    otherOwnerUserId,
    "active",
  );
  // A06 sibling (resend): invited memberships in this tenant.
  invitedOwnerMembershipId = await mkMembership(
    tenantId,
    "owner",
    invitedOwnerUserId,
    "invited",
  );
  invitedOwner2MembershipId = await mkMembership(
    tenantId,
    "owner",
    invitedOwner2UserId,
    "invited",
  );
  invitedCoachMembershipId = await mkMembership(
    tenantId,
    "coach",
    invitedCoachUserId,
    "invited",
  );

  adminCtx = await ctxFor(tenantId, adminUserId, "admin");
  ownerCtx = await ctxFor(tenantId, ownerUserId, "owner");

  inviteActions = await import("@/lib/actions/invite-link");
  staffInviteActions = await import("@/lib/actions/staff-invitations");
  tokenCodec = await import("@/lib/services/invite-link-token");
}, 120_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end().catch(() => {});
  await admin?.end();
  await container?.stop();
});

async function ctxFor(
  tid: TenantId,
  userId: UserId,
  roleKey: string,
): Promise<TestCtx> {
  const { rows } = await admin.query<{ permission_key: string }>(
    `select rp.permission_key
       from role_permissions rp
       join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
      where r.tenant_id = $1 and r.key = $2`,
    [tid, roleKey],
  );
  return {
    tenantId: tid,
    userId,
    roleKey,
    allLocations: true,
    locationIds: [],
    permissions: new Set(rows.map((r) => r.permission_key)),
    features: new Set(["staff"]),
    requestId: randomUUID(),
  };
}

async function auditCount(tid: TenantId = tenantId): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "select count(*)::text as n from audit_log where tenant_id=$1",
    [tid],
  );
  return Number(rows[0]!.n);
}

async function outboxFor(membershipId: string): Promise<number> {
  const { rows } = await admin.query(
    "select 1 from whatsapp_notification_outbox where tenant_id=$1 and event_key like $2",
    [tenantId, `login_link:${membershipId}:%`],
  );
  return rows.length;
}

async function usageCount(tid: TenantId = tenantId): Promise<number> {
  const { rows } = await admin.query(
    "select jti from invite_link_uses where tenant_id=$1",
    [tid],
  );
  return rows.length;
}

// Refusal may throw (ForbiddenError from requirePermission or the new
// issuer gate) or return an error result; both count. A token or a
// resolved success fails loudly.
async function refusalOf(run: () => Promise<unknown>): Promise<void> {
  let result: unknown;
  try {
    result = await run();
  } catch (error) {
    expect(String((error as Error).message)).toMatch(
      /forbidden|not allowed|permission|unauthorized|not authorized|trust/i,
    );
    return;
  }
  expect(result).toMatchObject({ kind: "error" });
  expect((result as { token?: unknown }).token).toBeUndefined();
}

describe("A06 owner credential issuance authority", () => {
  it("refuses an Administrator-issued Owner reset link with no token, audit or notification", async () => {
    const before = await auditCount();
    await refusalOf(() =>
      ownerReset.issueTenantOwnerResetLink(adminCtx, ownerMembershipId),
    );
    expect(await auditCount()).toBe(before);
    expect(await outboxFor(ownerMembershipId)).toBe(0);
    expect(await usageCount()).toBe(0);
  });

  it("refuses an Administrator-issued Owner relogin link through the issue action", async () => {
    mocks.ctx.mockResolvedValue(adminCtx);
    const before = await auditCount();
    await refusalOf(() => inviteActions.issueLoginLinkAction(ownerMembershipId));
    expect(await auditCount()).toBe(before);
    expect(await outboxFor(ownerMembershipId)).toBe(0);
    expect(await usageCount()).toBe(0);
  });

  it("lets an Owner mint an Owner reset link and audits it without the token", async () => {
    const result = await ownerReset.issueTenantOwnerResetLink(
      ownerCtx,
      ownerMembershipId,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.purpose).toBe("reset");

    const claims = tokenCodec.verifyInviteLinkToken(result.token);
    expect(claims).toMatchObject({
      purpose: "reset",
      membershipId: ownerMembershipId,
    });
    const ttlMs = result.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(
      (tokenCodec.RESET_LINK_TTL_SECONDS - 120) * 1000,
    );
    expect(ttlMs).toBeLessThanOrEqual(
      tokenCodec.RESET_LINK_TTL_SECONDS * 1000,
    );

    const { rows } = await admin.query<{
      actor_id: string;
      entity_id: string;
    }>(
      "select * from audit_log where tenant_id=$1 and action='owner.reset_link_issued' and entity_id=$2 order by created_at desc limit 1",
      [tenantId, ownerMembershipId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(ownerUserId);
    expect(JSON.stringify(rows)).not.toContain(result.token);
  });

  it("lets an Administrator mint lower-trust staff links and an Owner target Owner", async () => {
    mocks.ctx.mockResolvedValue(adminCtx);
    const coachLink = await inviteActions.issueLoginLinkAction(
      coachMembershipId,
    );
    expect(coachLink.kind).toBe("ok");
    if (coachLink.kind === "ok") expect(coachLink.purpose).toBe("relogin");
    expect(await outboxFor(coachMembershipId)).toBeGreaterThan(0);

    mocks.ctx.mockResolvedValue(ownerCtx);
    const ownerLink = await inviteActions.issueLoginLinkAction(
      ownerMembershipId,
    );
    expect(ownerLink.kind).toBe("ok");
  });

  it("refuses an Administrator resend for an invited Owner with no audit or outbox row", async () => {
    mocks.ctx.mockResolvedValue(adminCtx);
    const before = await auditCount();
    const result = await staffInviteActions.resendInvitationAction(
      invitedOwnerMembershipId,
    );
    // The resend mints no token, but it does materialise a bearer link
    // in the outbox — the issuer-target trust gate applies before that.
    expect(result).toMatchObject({ kind: "error", code: "forbidden_target" });
    expect(await auditCount()).toBe(before);
    expect(await outboxFor(invitedOwnerMembershipId)).toBe(0);
    const { rows } = await admin.query(
      "select id from audit_log where tenant_id=$1 and entity_id=$2",
      [tenantId, invitedOwnerMembershipId],
    );
    expect(rows).toEqual([]);
  });

  it("lets an Owner resend an invited Owner and audits the resend", async () => {
    mocks.ctx.mockResolvedValue(ownerCtx);
    const result = await staffInviteActions.resendInvitationAction(
      invitedOwner2MembershipId,
    );
    expect(result).toEqual({ kind: "ok", delivered: false });
    expect(await outboxFor(invitedOwner2MembershipId)).toBeGreaterThan(0);
    const resendRows = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id=$1 and entity_id=$2 and action='staff.invitation.resend'",
      [tenantId, invitedOwner2MembershipId],
    );
    expect(resendRows.rows.map((r) => r.action)).toEqual([
      "staff.invitation.resend",
    ]);
    const queuedRows = await admin.query(
      "select id from audit_log where tenant_id=$1 and action='whatsapp.invitation.queued' and after->>'membershipId'=$2",
      [tenantId, invitedOwner2MembershipId],
    );
    expect(queuedRows.rows).toHaveLength(1);
  });

  it("lets an Owner resend an invited lower-trust Coach", async () => {
    mocks.ctx.mockResolvedValue(ownerCtx);
    const result = await staffInviteActions.resendInvitationAction(
      invitedCoachMembershipId,
    );
    expect(result.kind).toBe("ok");
    expect(await outboxFor(invitedCoachMembershipId)).toBeGreaterThan(0);
  });

  it("denies cross-tenant and revoked targets", async () => {
    mocks.ctx.mockResolvedValue(ownerCtx);

    const crossTenant = await ownerReset.issueTenantOwnerResetLink(
      ownerCtx,
      otherOwnerMembershipId,
    );
    expect(crossTenant).toMatchObject({
      kind: "error",
      code: "membership_not_found",
    });

    const revokedReset = await ownerReset.issueTenantOwnerResetLink(
      ownerCtx,
      revokedOwnerMembershipId,
    );
    expect(revokedReset).toMatchObject({ kind: "error", code: "revoked" });

    const revokedLink = await inviteActions.issueLoginLinkAction(
      revokedOwnerMembershipId,
    );
    expect(revokedLink).toMatchObject({ kind: "error", code: "revoked" });

    const crossTenantLink = await inviteActions.issueLoginLinkAction(
      otherOwnerMembershipId,
    );
    expect(crossTenantLink).toMatchObject({
      kind: "error",
      code: "membership_not_found",
    });
  });
});
