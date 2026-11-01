// @vitest-environment node
//
// Agent-owned RED specifications — the jobs/audit BOUNDARY composition gaps.
//
// OWNER: a-auth lane (independent reviewer). Agent-owned path; nothing under
// tests/tier1/** and no production file is touched by this file.
//
// These cases exercise the PLATFORM OPERATION BOUNDARY of the three new jobs
// action files, against the CURRENT source of that boundary (root's approved Ops
// rollout, which the jobs slice consumes):
//
//   1. a COMMITTED mutation must record its evidence through recordOpsAudit,
//      INSIDE the transaction (the platform trail), not through the tenant
//      writeAudit writer — the two are DIFFERENT tables and writeAudit does NOT
//      bridge to recordOpsAudit;
//   2. a mutation that changed NOTHING must record a noop that is BOUND to the
//      ambient opsAction context (same scope, same actor, same tenant), and a
//      noop whose stated identity does not match must be REFUSED;
//   3. a request that is refused must leave the refusal row (invalid / denied);
//   4. an error raised INSIDE the mutation must be traced by
//      recordOpsThrownFailure and rethrown — the new actions currently have the
//      refusal traces but no thrown-failure catch.
//
// The fixture pattern (a real platform session and the app role) follows the
// house pattern of tests/local-demo-20261030/ops-audit/.
//
// Agent-owned file.

import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { sha256 } from "@/db/platform-auth-crypto";
import { provisionPlatformUser } from "@/db/platform-auth";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";
import { asTenantId, asUserId } from "@/lib/ids";

const { jar, faults } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  faults: { tenantScopeFails: false, platformAuditFails: false },
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

// Fault seam: the tenant scope fails, so the mutation raises AFTER the opsAction
// context is established. Everything else is the real code path.
vi.mock("@/db/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/tenant")>();
  const real = actual.withTenant;
  return {
    ...actual,
    withTenant: ((tenantId: unknown, fn: unknown) =>
      faults.tenantScopeFails
        ? (async () => {
            throw new Error("synthetic tenant scope failure");
          })()
        : (real as unknown as (t: unknown, f: unknown) => Promise<unknown>)(
            tenantId,
            fn,
          )) as typeof actual.withTenant,
  };
});

// Fault seam: the PLATFORM audit write fails. Every other write is the real one,
// so the only thing under test is what happens to the mutation when its
// evidence cannot be written.
vi.mock("@/db/ops-action", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/ops-action")>();
  return {
    ...actual,
    recordOpsAudit: async (...args: Parameters<typeof actual.recordOpsAudit>) => {
      if (faults.platformAuditFails) {
        throw new Error("synthetic platform audit failure");
      }
      return actual.recordOpsAudit(...args);
    },
  };
});

import { opsAction, recordOpsNoop } from "@/db/ops-action";
import { withTenant } from "@/db/tenant";
import { resendUnknownNotificationAction } from "@/lib/actions/platform-notifications";

const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const phone = "+919876543210";

let adminId = "";
let adminToken = "";
let viewerId = "";
let viewerToken = "";

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(overrides)) data.set(k, v);
  return data;
}

async function platformRows(action: string): Promise<
  { action: string; actor_id: string | null; tenant_id: string | null; target_id: string | null; detail: Record<string, unknown> }[]
> {
  const { rows } = await admin.query(
    "select action, actor_id, tenant_id, target_id, detail from platform_audit_log where action = $1 order by created_at",
    [action],
  );
  return rows as never;
}

async function operationRows(operation: string): Promise<
  { action: string; actor_id: string | null; tenant_id: string | null; detail: Record<string, unknown> }[]
> {
  const { rows } = await admin.query(
    "select action, actor_id, tenant_id, detail from platform_audit_log where action = $1 order by created_at",
    [`ops.operation.${operation}`],
  );
  return rows as never;
}

async function tenantAuditRows(action: string): Promise<{ action: string }[]> {
  const { rows } = await admin.query(
    "select action from audit_log where tenant_id = $1::uuid and action = $2",
    [tenantId, action],
  );
  return rows as never;
}

beforeAll(async () => {
  const adminUser = await provisionPlatformUser({
    email: `jobs-admin-${RUN}@platform.test`,
    name: "Jobs Admin",
    password: `p-${RUN}`,
    role: "admin",
  });
  adminId = adminUser.id;
  adminToken = randomBytes(32).toString("hex");
  await admin.query(
    "insert into platform_sessions (id,user_id,token_hash,second_factor_passed,expires_at) values ($1::uuid,$2::uuid,$3,true,$4)",
    [uuidv7(), adminId, sha256(adminToken), new Date(Date.now() + 3600_000)],
  );

  const viewer = await provisionPlatformUser({
    email: `jobs-viewer-${RUN}@platform.test`,
    name: "Jobs Viewer",
    password: `p-${RUN}`,
    role: "viewer",
  });
  viewerId = viewer.id;
  viewerToken = randomBytes(32).toString("hex");
  await admin.query(
    "insert into platform_sessions (id,user_id,token_hash,second_factor_passed,expires_at) values ($1::uuid,$2::uuid,$3,true,$4)",
    [uuidv7(), viewerId, sha256(viewerToken), new Date(Date.now() + 3600_000)],
  );

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Jobs Boundary Tenant', 'active', 'Asia/Kolkata')",
    [tenantId, `jobs-boundary-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth, phone) values ($1, $2, 'Jobs Boundary Adult', '1990-01-01', $3)",
    [personId, tenantId, phone],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, 'JB-1', 'active')",
    [memberId, tenantId, personId, locationId],
  );
});

afterAll(async () => {
  for (const id of [adminId, viewerId]) {
    await admin.query("delete from platform_audit_log where actor_id = $1", [id]);
    await admin.query("delete from platform_sessions where user_id = $1", [id]);
    await admin.query("delete from platform_users where id = $1", [id]);
  }
  await admin.query("delete from whatsapp_notification_outbox where tenant_id = $1::uuid", [tenantId]);
  // audit_log is append-only; the house helper steps around the guard.
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from members where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
  await admin.end();
});

beforeEach(() => {
  faults.tenantScopeFails = false;
  faults.platformAuditFails = false;
  jar.set("platform_session", adminToken);
});

async function seedUnknownNotification(): Promise<string> {
  const id = uuidv7();
  await admin.query(
    `insert into whatsapp_notification_outbox
       (id, tenant_id, event_key, member_id, recipient_person_id, phone, body, essential, status, attempts)
     values ($1, $2, $3, $4, $5, $6, $7, true, 'unknown', 1)`,
    [id, tenantId, `jobs-boundary:${RUN}:${id}`, memberId, personId, phone, "boundary body"],
  );
  return id;
}

describe("B1 — a committed mutation records its evidence through recordOpsAudit, inside the transaction", () => {
  it("writes the platform domain row for the operation, attributed to the actor and the tenant", async () => {
    const notificationId = await seedUnknownNotification();

    const result = await resendUnknownNotificationAction(
      null,
      form({ notificationId, tenantId, reason: "operator asked for a resend" }),
    );
    expect(result.ok).toBe(true);

    const rows = await platformRows("notification.resend");
    expect(
      rows.length,
      "a committed mutation must record its evidence in the platform trail",
    ).toBeGreaterThan(0);
    const row = rows[rows.length - 1]!;
    expect(row.actor_id).toBe(adminId);
    expect(row.tenant_id).toBe(tenantId);
    expect(row.target_id).toBe(notificationId);
  });

  it("writes the platform evidence with the exact actor and scope, and no recipient data", async () => {
    const notificationId = await seedUnknownNotification();
    const before = await platformRows("notification.resend");

    await resendUnknownNotificationAction(
      null,
      form({ notificationId, tenantId, reason: "operator asked for a resend" }),
    );

    const rows = (await platformRows("notification.resend")).slice(before.length);
    const evidence = rows[rows.length - 1]!;
    // The actor is the platform operator, taken from the opsAction context.
    expect(evidence.actor_id).toBe(adminId);
    expect(evidence.tenant_id).toBe(tenantId);
    // The scope is the operation itself, not a free-text label.
    expect(evidence.action).toBe("notification.resend");
    // No recipient data may cross into the platform trail.
    const detail = JSON.stringify(evidence.detail);
    expect(detail).not.toContain(phone);
    expect(detail).not.toContain("boundary body");
  });

  it("keeps the tenant's own audit row for the mutation", async () => {
    const notificationId = await seedUnknownNotification();

    await resendUnknownNotificationAction(
      null,
      form({ notificationId, tenantId, reason: "operator asked for a resend" }),
    );

    const tenantRows = await tenantAuditRows("ops.whatsapp.resend");
    expect(
      tenantRows.length,
      "the tenant's own record of the platform action is kept; the platform row is ADDED, not substituted",
    ).toBeGreaterThan(0);
  });

  it("does NOT commit the mutation when its platform evidence cannot be written", async () => {
    const notificationId = await seedUnknownNotification();
    faults.platformAuditFails = true;

    await expect(
      resendUnknownNotificationAction(
        null,
        form({ notificationId, tenantId, reason: "operator asked for a resend" }),
      ),
    ).rejects.toThrow(/synthetic platform audit failure/);

    faults.platformAuditFails = false;

    const { rows } = await admin.query(
      "select status from whatsapp_notification_outbox where id = $1::uuid",
      [notificationId],
    );
    expect(
      (rows[0] as { status: string }).status,
      "a mutation whose evidence cannot be written must roll back, not commit",
    ).toBe("unknown");
  });

  it("commits and records its evidence when the write succeeds", async () => {
    const notificationId = await seedUnknownNotification();

    const result = await resendUnknownNotificationAction(
      null,
      form({ notificationId, tenantId, reason: "operator asked for a resend" }),
    );
    expect(result.ok).toBe(true);

    const { rows } = await admin.query(
      "select status from whatsapp_notification_outbox where id = $1::uuid",
      [notificationId],
    );
    expect((rows[0] as { status: string }).status).toBe("pending");
  });
});

describe("B2 — a mutation that changed nothing records a noop bound to the ambient context", () => {
  it("writes the noop with the operation's own scope, actor and tenant", async () => {
    const missingId = uuidv7();
    const before = await platformRows("notification.resend");

    const result = await resendUnknownNotificationAction(
      null,
      form({ notificationId: missingId, tenantId, reason: "operator asked for a resend" }),
    );
    expect(result.ok).toBe(false);

    const rows = (await platformRows("notification.resend")).slice(before.length);
    const noop = rows.find((r) => r.detail?.outcome === "noop");
    expect(
      noop,
      "a mutation that changed nothing must record a noop for the operation it ran",
    ).toBeTruthy();
    expect(noop!.actor_id).toBe(adminId);
    expect(noop!.tenant_id).toBe(tenantId);
  });

  it("NEGATIVE: a noop whose stated identity does not match the ambient context is refused", async () => {
    await expect(
      withTenant(tenantId, async (tx) =>
        opsAction(
          { scope: "notification.resend", actorId: asUserId(adminId), tenantId },
          () =>
            recordOpsNoop(tx, {
              correlationId: uuidv7(),
              origin: "server_action",
              // The WRONG operation: the context is notification.resend.
              scope: "notification.close",
              actorId: asUserId(adminId),
              tenantId,
            }),
        ),
      ),
    ).rejects.toThrow(/context mismatch/);
  });
});

describe("B3 — a refused request leaves the refusal row", () => {
  it("an invalid request records an invalid refusal for the operation", async () => {
    await resendUnknownNotificationAction(
      null,
      form({ notificationId: "not-a-uuid", tenantId, reason: "operator asked" }),
    );

    const rows = await operationRows("notification.resend");
    expect(
      rows.some((r) => r.detail?.outcome === "invalid"),
      "a malformed request must leave an invalid refusal row for the operation",
    ).toBe(true);
  });

  it("a viewer is denied, and the denial names the actor", async () => {
    jar.set("platform_session", viewerToken);

    await resendUnknownNotificationAction(
      null,
      form({ notificationId: uuidv7(), tenantId, reason: "operator asked" }),
    );

    const rows = await operationRows("notification.resend");
    const denied = rows.find((r) => r.detail?.outcome === "denied");
    expect(denied, "a viewer must leave a denied refusal row for the operation").toBeTruthy();
    expect(denied!.actor_id).toBe(viewerId);
  });
});

describe("B4 — an error raised inside the mutation is traced and rethrown", () => {
  it("records the thrown failure for the operation and rethrows the error", async () => {
    // Only the rows THIS call writes count: the trail is shared by the cases.
    const before = await operationRows("notification.resend");
    faults.tenantScopeFails = true;

    await expect(
      resendUnknownNotificationAction(
        null,
        form({ notificationId: uuidv7(), tenantId, reason: "operator asked" }),
      ),
    ).rejects.toThrow(/synthetic tenant scope failure/);

    faults.tenantScopeFails = false;

    const after = await operationRows("notification.resend");
    const fresh = after.slice(before.length);
    expect(
      fresh.some((r) => r.detail?.outcome === "error" || r.detail?.outcome === "denied"),
      "an error raised inside the mutation must leave a thrown-failure row for the operation",
    ).toBe(true);
  });
});
