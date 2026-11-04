// @vitest-environment node
//
// Backend validation — the Academy profile currency is INR-only for this
// release. docs/project-scope.md §6.5 says "All currency in INR"; the
// tenant schema defaults to INR and lib/money/format.ts formats INR only.
//
// The current action/service accept any uppercase 3-letter ISO code and
// write it to the tenant row. This file is the intended RED before the
// smallest validation fix, using the REAL tenant session path
// (requireDefaultCtx -> resolveDefaultMembership -> role permissions) over
// the app-role connection; only the better-auth and next/headers framework
// edges are stubbed, as in the existing role/context tests.
//
// Acceptance:
//   * unsupported USD/SGD are refused by the action AND the service, with
//     no tenant mutation and no success audit;
//   * an existing non-INR tenant stays visible/unchanged (no silent INR);
//   * INR and other profile edits (name/timezone/GSTIN, with or without a
//     read-only currency field) still work, with the existing audit;
//   * permissions and tenant scope are unchanged.
//
// No protected tier1 test is edited; this file is in the lane's own prefix.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { seedRoleTemplates } from "@/lib/services/roles";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";
import { updateTenantProfile } from "@/lib/services/tenant-profile";

const { authUser } = vi.hoisted(() => ({ authUser: { betterAuthId: "" } }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: authUser.betterAuthId },
        session: { createdAt: new Date() },
      }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

// Imported after the framework mocks are hoisted: the action must run the
// real requireDefaultCtx/permission/service path.
import {
  getTenantProfileAction,
  updateTenantProfileAction,
} from "@/lib/actions/tenant-profile";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const userA = asUserId(uuidv7());
const userB = asUserId(uuidv7());
const coach = asUserId(uuidv7());
const coachMembership = uuidv7();

const ORIGINAL_A = {
  name: "INR Academy",
  currency: "INR",
  timezone: "Asia/Kolkata",
  gstin: null,
};
const ORIGINAL_B = {
  name: "Existing Dollar Academy",
  currency: "USD",
  timezone: "America/New_York",
  gstin: null,
};

type Row = {
  name: string;
  currency: string;
  timezone: string;
  gstin: string | null;
};

async function tenantRow(id: TenantId): Promise<Row> {
  const { rows } = await admin.query<Row>(
    "select name, currency, timezone, gstin from tenants where id = $1",
    [id],
  );
  return rows[0]!;
}

async function auditCount(id: TenantId): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = 'tenant.profile.update'",
    [id],
  );
  return Number(rows[0]!.count);
}

async function latestAudit(id: TenantId) {
  const { rows } = await admin.query<{
    before: Row;
    after: Row;
    changed_fields: string[];
    request_id: string | null;
  }>(
    "select before, after, changed_fields, request_id from audit_log where tenant_id = $1 and action = 'tenant.profile.update' order by created_at desc limit 1",
    [id],
  );
  return rows[0]!;
}

function actionInput(overrides: Partial<Record<string, string>> = {}) {
  return {
    name: ORIGINAL_A.name,
    currency: "INR",
    timezone: ORIGINAL_A.timezone,
    gstin: "",
    ...overrides,
  };
}

async function ownerId(tenantId: TenantId, key = "owner"): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1 and key = $2",
    [tenantId, key],
  );
  if (!rows[0]) throw new Error(`missing ${key} role for ${tenantId}`);
  return rows[0].id;
}

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone, currency, gstin) values
       ($1, $3, $5, 'active', $6, $7, null),
       ($2, $4, $8, 'active', $9, $10, null)`,
    [
      tenantA,
      tenantB,
      `inr-profile-${RUN}`,
      `usd-profile-${RUN}`,
      ORIGINAL_A.name,
      ORIGINAL_A.timezone,
      ORIGINAL_A.currency,
      ORIGINAL_B.name,
      ORIGINAL_B.timezone,
      ORIGINAL_B.currency,
    ],
  );
  await seedRoleTemplates(tenantA);
  await seedRoleTemplates(tenantB);

  for (const [id, phone, betterAuthId] of [
    [userA, `+9198${String(Date.now()).slice(-8)}1`, `inr-ba-${RUN}`],
    [userB, `+9198${String(Date.now()).slice(-8)}2`, `usd-ba-${RUN}`],
    [coach, `+9198${String(Date.now()).slice(-8)}3`, `coach-ba-${RUN}`],
  ] as const) {
    await admin.query(
      "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
      [id, phone, betterAuthId],
    );
  }

  const ownerA = await ownerId(tenantA);
  const ownerB = await ownerId(tenantB);
  const coachRole = await ownerId(tenantA, "coach");
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status) values
       ($1, $2, $3, $4, true, 'active'),
       ($5, $6, $7, $8, true, 'active'),
       ($9, $2, $10, $11, true, 'active')`,
    [
      uuidv7(),
      tenantA,
      userA,
      ownerA,
      uuidv7(),
      tenantB,
      userB,
      ownerB,
      coachMembership,
      coach,
      coachRole,
    ],
  );
}, 120_000);

afterAll(async () => {
  for (const t of [tenantA, tenantB]) {
    await deleteAuditRowsForTenant(admin, t);
  }
  await admin.query("delete from tenant_memberships where tenant_id = any($1::uuid[])", [
    [tenantA, tenantB],
  ]);
  await admin.query("delete from roles where tenant_id = any($1::uuid[])", [
    [tenantA, tenantB],
  ]);
  await admin.query("delete from tenants where id = any($1::uuid[])", [
    [tenantA, tenantB],
  ]);
  await admin.query("delete from users where id = any($1::uuid[])", [
    [userA, userB, coach],
  ]);
  await admin.end();
}, 120_000);

describe("Academy profile currency is INR-only", () => {
  it("refuses USD through the real session/action without mutation or success audit", async () => {
    authUser.betterAuthId = `inr-ba-${RUN}`;
    const before = await tenantRow(tenantA);
    const auditsBefore = await auditCount(tenantA);

    const result = await updateTenantProfileAction(
      actionInput({ name: "Should Not Apply", currency: "USD" }),
    );

    expect(result.kind, "USD must be refused").toBe("error");
    if (result.kind === "error") expect(result.message).toMatch(/INR/);
    expect(await tenantRow(tenantA), "no mutation").toEqual(before);
    expect(await auditCount(tenantA), "no success audit").toBe(auditsBefore);
  }, 60_000);

  it("refuses SGD through the real session/action without mutation or success audit", async () => {
    authUser.betterAuthId = `inr-ba-${RUN}`;
    const before = await tenantRow(tenantA);
    const auditsBefore = await auditCount(tenantA);

    const result = await updateTenantProfileAction(
      actionInput({ name: "Should Not Apply", currency: "SGD" }),
    );

    expect(result.kind, "SGD must be refused").toBe("error");
    if (result.kind === "error") expect(result.message).toMatch(/INR/);
    expect(await tenantRow(tenantA)).toEqual(before);
    expect(await auditCount(tenantA)).toBe(auditsBefore);
  }, 60_000);

  it("refuses the existing USD metadata when a caller tries to write it back", async () => {
    authUser.betterAuthId = `usd-ba-${RUN}`;
    const before = await tenantRow(tenantB);
    const auditsBefore = await auditCount(tenantB);

    const result = await updateTenantProfileAction({
      ...actionInput({ name: "Should Not Apply", currency: "USD" }),
      timezone: ORIGINAL_B.timezone,
    });

    expect(result.kind, "USD is unsupported even when it is the stored value").toBe(
      "error",
    );
    expect(await tenantRow(tenantB), "existing USD stays visible/unchanged").toEqual(
      before,
    );
    expect(await auditCount(tenantB)).toBe(auditsBefore);
  }, 60_000);

  it("keeps an existing non-INR tenant unchanged when currency is omitted (read-only field)", async () => {
    authUser.betterAuthId = `usd-ba-${RUN}`;
    const before = await tenantRow(tenantB);
    const auditsBefore = await auditCount(tenantB);

    const result = await updateTenantProfileAction({
      name: "Existing Dollar Academy Renamed",
      timezone: ORIGINAL_B.timezone,
      gstin: "",
    });

    expect(result, "other edits must work without a currency field").toEqual({
      kind: "ok",
    });
    const after = await tenantRow(tenantB);
    expect(after.name).toBe("Existing Dollar Academy Renamed");
    expect(after.currency, "no silent INR conversion").toBe("USD");
    expect(after.currency).toBe(before.currency);
    expect(await auditCount(tenantB)).toBe(auditsBefore + 1);
    const audit = await latestAudit(tenantB);
    expect(audit.before.currency).toBe("USD");
    expect(audit.after.currency).toBe("USD");
    expect(audit.changed_fields).toEqual(["name"]);
  }, 60_000);

  it("accepts legitimate INR and other profile edits without a currency field", async () => {
    authUser.betterAuthId = `inr-ba-${RUN}`;
    const auditsBefore = await auditCount(tenantA);

    const result = await updateTenantProfileAction({
      name: "INR Academy Renamed",
      timezone: "Asia/Kolkata",
      gstin: "27abcde1234f1z5",
    });

    expect(result).toEqual({ kind: "ok" });
    const after = await tenantRow(tenantA);
    expect(after.name).toBe("INR Academy Renamed");
    expect(after.currency).toBe("INR");
    expect(after.gstin).toBe("27ABCDE1234F1Z5");
    expect(await auditCount(tenantA)).toBe(auditsBefore + 1);
    const audit = await latestAudit(tenantA);
    expect(audit.changed_fields).toEqual(["name", "gstin"]);
    expect(audit.before.currency).toBe("INR");
    expect(audit.after.currency).toBe("INR");
  }, 60_000);

  it("accepts a legitimate INR update through the action", async () => {
    authUser.betterAuthId = `inr-ba-${RUN}`;
    const result = await updateTenantProfileAction(
      actionInput({ name: "INR Academy Two", currency: "INR" }),
    );
    expect(result).toEqual({ kind: "ok" });
    expect((await tenantRow(tenantA)).currency).toBe("INR");
  }, 60_000);

  it("refuses USD/SGD in the service too, with no mutation or audit", async () => {
    const ctx = { tenantId: tenantA, userId: userA };
    const before = await tenantRow(tenantA);
    const auditsBefore = await auditCount(tenantA);

    for (const currency of ["USD", "SGD"]) {
      const result = await updateTenantProfile(ctx, { currency });
      expect(result.kind, `${currency} must be refused by the service`).toBe(
        "error",
      );
      expect(await tenantRow(tenantA)).toEqual(before);
      expect(await auditCount(tenantA)).toBe(auditsBefore);
    }
  }, 60_000);

  it("keeps the existing USD value when the service updates another field", async () => {
    const ctx = { tenantId: tenantB, userId: userB };
    const result = await updateTenantProfile(ctx, { name: "Service Rename" });
    expect(result).toEqual({ kind: "ok" });
    const after = await tenantRow(tenantB);
    expect(after.name).toBe("Service Rename");
    expect(after.currency).toBe("USD");
    const audit = await latestAudit(tenantB);
    expect(audit.before.currency).toBe("USD");
    expect(audit.after.currency).toBe("USD");
  }, 60_000);

  it("keeps the read action showing the existing non-INR metadata", async () => {
    authUser.betterAuthId = `usd-ba-${RUN}`;
    const profile = await getTenantProfileAction();
    expect(profile?.currency).toBe("USD");
    expect(profile?.name).toBe("Service Rename");
  }, 60_000);

  it("preserves the settings.manage permission and tenant scope", async () => {
    authUser.betterAuthId = `coach-ba-${RUN}`;
    const beforeA = await tenantRow(tenantA);
    const beforeB = await tenantRow(tenantB);
    const auditsA = await auditCount(tenantA);
    const auditsB = await auditCount(tenantB);

    await expect(
      updateTenantProfileAction(actionInput({ name: "Coach Must Not Write" })),
    ).rejects.toThrow(/settings.manage/i);

    expect(await tenantRow(tenantA)).toEqual(beforeA);
    expect(await tenantRow(tenantB)).toEqual(beforeB);
    expect(await auditCount(tenantA)).toBe(auditsA);
    expect(await auditCount(tenantB)).toBe(auditsB);
  }, 60_000);
});
