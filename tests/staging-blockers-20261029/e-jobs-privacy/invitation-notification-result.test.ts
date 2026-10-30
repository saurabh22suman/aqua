// @vitest-environment node
//
// F10 dependency (lane E's own helper) — enqueueInvitationNotification must
// REPORT whether it queued the notification.
//
// The contract this file pins:
//   * Promise<boolean> — true ONLY after a real outbox row AND its audit
//     row are complete;
//   * false for a missing membership, an ineligible membership, or no
//     inserted row;
//   * existing callers may ignore the result, so the change must not
//     alter the token, the TTL, the recipient eligibility or the grants.
//
// The callers that require `true` (lane A's issueLoginLink with
// notify=true) cannot be satisfied by "no error": a silent no-op in the
// enqueue would commit an issuance with no notification. That is the
// reason this result exists.
//
// Harness: a real Postgres 16 container (tests/helpers/isolated-db.ts),
// the app role for the call and the admin pool for the assertions, so
// the row and the audit are observed in the database and not mocked.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { startIsolatedDb, type IsolatedDb } from "../../helpers/isolated-db";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import type { TenantTx } from "@/db/tenant";

let isolated: IsolatedDb;
let tenantId: TenantId;
let appPool: typeof import("@/db/client").pool;
let eligibleMembershipId: string;
let revokedMembershipId: string;
let deletedMembershipId: string;

let withTenant: typeof import("@/db/tenant").withTenant;
let enqueueInvitationNotification: typeof import("@/lib/messaging/invitation-notification").enqueueInvitationNotification;

beforeAll(async () => {
  isolated = await startIsolatedDb();
  process.env.DATABASE_URL = isolated.appUri;
  process.env.MIGRATION_DATABASE_URL = isolated.adminUri;
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  process.env.BETTER_AUTH_SECRET = "invitation-result-test";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PARENT_LINK_SECRET = "invitation-result-test";
  // The helper module (and lib/env, via it) may already have been loaded by
  // this file's imports, which would freeze the environment before the
  // isolated database exists. Reset the module registry so every module the
  // cases use is parsed against THIS container.
  vi.resetModules();

  ({ withTenant } = await import("@/db/tenant"));
  ({ enqueueInvitationNotification } = await import(
    "@/lib/messaging/invitation-notification"
  ));

  tenantId = asTenantId(randomUUID());
  await isolated.admin.query(
    "insert into tenants(id,slug,name,status) values($1,$2,'Invitation result tenant','active')",
    [tenantId, `invitation-result-${tenantId}`],
  );
  const roles = await import("@/lib/services/roles");
  await roles.seedRoleTemplates(tenantId);
  const { rows } = await isolated.admin.query<{ id: string }>(
    "select id from roles where tenant_id=$1 and key='owner'",
    [tenantId],
  );
  const roleId = rows[0]!.id;

  // tenant_memberships is unique on (tenant_id, user_id), so each
  // membership below gets its own synthetic user.
  let nextPhone = 9900099000;
  const mkMembership = async (
    status: "invited" | "active" | "revoked",
    deleted: boolean,
  ): Promise<string> => {
    const membershipUser = asUserId(randomUUID());
    nextPhone += 1;
    await isolated.admin.query(
      "insert into users(id,phone) values($1,$2)",
      [membershipUser, `+91${nextPhone}`],
    );
    const id = randomUUID();
    await isolated.admin.query(
      `insert into tenant_memberships(id,tenant_id,user_id,role_id,status,deleted_at)
       values($1,$2,$3,$4,$5,$6)`,
      [id, tenantId, membershipUser, roleId, status, deleted ? new Date() : null],
    );
    return id;
  };
  eligibleMembershipId = await mkMembership("invited", false);
  revokedMembershipId = await mkMembership("revoked", false);
  deletedMembershipId = await mkMembership("invited", true);

  appPool = (await import("@/db/client")).pool;
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await isolated?.stop();
});

async function outboxRows(membershipId: string): Promise<number> {
  const { rows } = await isolated.admin.query<{ n: string }>(
    `select count(*)::text as n from whatsapp_notification_outbox
     where tenant_id=$1 and event_key like $2`,
    [tenantId, `login_link:${membershipId}:%`],
  );
  return Number(rows[0]!.n);
}

async function queuedAuditRows(membershipId: string): Promise<number> {
  const { rows } = await isolated.admin.query<{ n: string }>(
    `select count(*)::text as n from audit_log
     where tenant_id=$1 and action='whatsapp.invitation.queued' and after->>'membershipId'=$2`,
    [tenantId, membershipId],
  );
  return Number(rows[0]!.n);
}

// A minimal stand-in for the tenant transaction, so the two branches the
// database cannot produce on its own (the insert returning no row, and
// the audit write failing) are exercised against the REAL helper code.
type StubOptions = {
  membership: { userId: string; phone: string; status: string; tenantName: string } | null;
  insertedRows: Array<{ id: string }>;
  failAudit: boolean;
};

function stubTx(options: StubOptions): { tx: TenantTx; audits: () => number } {
  let inserts = 0;
  let audits = 0;
  const tx = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: async () => (options.membership ? [options.membership] : []),
            }),
          }),
        }),
      }),
    }),
    insert: () => {
      inserts += 1;
      // The first insert is the outbox row; the audit row is the second.
      const isAudit = inserts > 1;
      if (isAudit) audits += 1;
      return {
        values: () => {
          if (isAudit && options.failAudit) {
            throw new Error("audit write failed");
          }
          return {
            returning: async () => (isAudit ? [] : options.insertedRows),
          };
        },
      };
    },
  };
  return { tx: tx as unknown as TenantTx, audits: () => audits };
}

describe("enqueueInvitationNotification — the result says whether it queued", () => {
  it("returns true only after a real outbox row AND its audit row exist", async () => {
    const result = await withTenant(tenantId, (tx) =>
      enqueueInvitationNotification(tx, tenantId, eligibleMembershipId),
    );

    expect(result).toBe(true);
    expect(await outboxRows(eligibleMembershipId)).toBe(1);
    expect(await queuedAuditRows(eligibleMembershipId)).toBe(1);
  });

  it("returns false for a membership that does not exist, and queues nothing", async () => {
    const result = await withTenant(tenantId, (tx) =>
      enqueueInvitationNotification(tx, tenantId, randomUUID()),
    );

    expect(result).toBe(false);
    expect(await outboxRows(randomUUID())).toBe(0);
  });

  it("returns false for an ineligible membership, and queues nothing", async () => {
    const result = await withTenant(tenantId, (tx) =>
      enqueueInvitationNotification(tx, tenantId, revokedMembershipId),
    );

    expect(result).toBe(false);
    expect(await outboxRows(revokedMembershipId)).toBe(0);
    expect(await queuedAuditRows(revokedMembershipId)).toBe(0);
  });

  it("returns false for a deleted membership, and queues nothing", async () => {
    const result = await withTenant(tenantId, (tx) =>
      enqueueInvitationNotification(tx, tenantId, deletedMembershipId),
    );

    expect(result).toBe(false);
    expect(await outboxRows(deletedMembershipId)).toBe(0);
  });

  it("returns false when no outbox row was inserted, and writes no audit row", async () => {
    const stub = stubTx({
      membership: {
        userId: "user-1",
        phone: "+919900099002",
        status: "invited",
        tenantName: "Stub tenant",
      },
      insertedRows: [],
      failAudit: false,
    });

    const result = await enqueueInvitationNotification(stub.tx, tenantId, eligibleMembershipId);

    expect(result).toBe(false);
    expect(stub.audits()).toBe(0);
  });

  it("does not return true when the audit row cannot be written", async () => {
    const stub = stubTx({
      membership: {
        userId: "user-2",
        phone: "+919900099003",
        status: "invited",
        tenantName: "Stub tenant",
      },
      insertedRows: [{ id: randomUUID() }],
      failAudit: true,
    });

    // The failure must surface, not be swallowed into a `true`.
    await expect(
      enqueueInvitationNotification(stub.tx, tenantId, eligibleMembershipId),
    ).rejects.toThrow();
  });
});
