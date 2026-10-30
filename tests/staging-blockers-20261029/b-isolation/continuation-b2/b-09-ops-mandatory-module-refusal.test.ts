// F05 (staging blocker, 29 October 2026) — the public per-tenant
// entitlement action must REFUSE a mandatory core module.
//
// The six core modules (members, attendance, programs, enquiries,
// staff, settings) are MANDATORY: the runtime
// (lib/auth/permission.ts) keeps them on for every tenant, whatever
// the plan or any stored override says. The Ops entitlement editor
// already offers no switch for them (F05, b-08). The SERVER, however,
// still accepted an enable / disable / override / reset on ANY key, so
// a crafted request could store a row that changes nothing at runtime
// while the console reads as a committed entitlement.
//
// The contract this file pins:
//
//   1. an admin request that forces a mandatory module on or off is
//      refused: no entitlement row is written and no success audit is
//      recorded;
//   2. the legacy "override" shape is refused the same way;
//   3. a reset on a mandatory module is refused AND leaves any stored
//      historical override untouched — the runtime ignores it, and this
//      action has no business deleting a customer's row;
//   4. an ordinary OPTIONAL module still enables, disables, resets and
//      keeps its timed expiry;
//   5. the role denial still comes FIRST: a viewer is told their
//      account is read-only, not that a module is mandatory;
//   6. the strict legacy validation still rejects an undescribed
//      intent.
//
// The mandatory keys come from lib/feature-flags.ts's isMandatoryModule
// — the same helper the console uses to hide the switch — so the
// server refuses exactly what the UI no longer offers.
//
// The cases call the public action directly against the disposable test
// database: the action is the trust boundary, and the rows it leaves
// behind (or does not) are the evidence. Every case owns its own
// feature key, so no case depends on another case's rows.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../../db/privileged-fixture";

const { actor } = vi.hoisted(() => ({
  actor: { id: "", role: "admin" as "admin" | "viewer" },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/actions/platform-auth", () => ({
  requireOpsAdminAction: async () =>
    actor.role === "admin"
      ? { kind: "ok", userId: actor.id, role: "admin" }
      : { kind: "error", reason: "forbidden" },
}));

import { upsertTenantFeatureAction } from "@/lib/actions/platform-features";
import { MANDATORY_MODULES } from "@/lib/feature-flags";

const RUN = Date.now().toString(36);
const TENANT_ID = uuidv7();
const TENANT_SLUG = `bv-b09-t-${RUN}`;
const ADMIN_EMAIL = `bv-b09-admin-${RUN}@platform.test`;

/** The catalogue rows this run created, so cleanup never drops a seed row. */
const createdFeatureKeys: string[] = [];

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

/** A feature key of this run's own, for the cases that need one. */
function optionalKey(name: string): string {
  return `bv-b09-opt-${name}-${RUN}`;
}

async function readOverride(
  featureKey: string,
): Promise<{ enabled: boolean; expiresAt: string | null } | null> {
  const { rows } = await admin.query<{ enabled: boolean; expires_at: Date | null }>(
    "select enabled, expires_at from tenant_features where tenant_id = $1 and feature_key = $2",
    [TENANT_ID, featureKey],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    enabled: row.enabled,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  };
}

/** Success audits recorded for one feature key of this tenant. */
async function auditCount(featureKey: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    `select count(*)::int as n from platform_audit_log
      where tenant_id = $1
        and action like 'tenant_feature.%'
        and detail->>'featureKey' = $2`,
    [TENANT_ID, featureKey],
  );
  return rows[0]!.n;
}

async function ensureFeature(key: string, name: string): Promise<void> {
  const { rows } = await admin.query<{ key: string }>(
    "select key from features where key = $1",
    [key],
  );
  if (rows.length > 0) return;
  await admin.query(
    "insert into features (key, name, category, status) values ($1, $2, 'core', 'ga')",
    [key, name],
  );
  createdFeatureKeys.push(key);
}

beforeAll(async () => {
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values (gen_random_uuid(), $1, 'B09 Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do nothing`,
    [ADMIN_EMAIL],
  );
  const found = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [ADMIN_EMAIL],
  );
  actor.id = found.rows[0]!.id;

  // The mandatory module names must exist in the catalogue, so a
  // refused request is refused by the POLICY and not by a missing
  // feature row.
  for (const key of MANDATORY_MODULES) {
    await ensureFeature(key, key);
  }

  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'B09 Tenant', 'trial')",
    [TENANT_ID, TENANT_SLUG],
  );
});

afterAll(async () => {
  await admin.query("delete from platform_audit_log where tenant_id = $1", [TENANT_ID]);
  await admin.query("delete from tenant_features where tenant_id = $1", [TENANT_ID]);
  await admin.query("delete from tenants where id = $1", [TENANT_ID]);
  for (const key of createdFeatureKeys) {
    await admin.query("delete from features where key = $1", [key]);
  }
  await admin.query("delete from platform_users where email = $1", [ADMIN_EMAIL]);
  await admin.end();
});

async function submit(values: Record<string, string>) {
  return upsertTenantFeatureAction(
    null,
    formData({ tenantId: TENANT_ID, ...values }),
  );
}

describe("F05 — a mandatory core module cannot be forced on or off", () => {
  it("refuses to force on every mandatory core module", async () => {
    for (const key of MANDATORY_MODULES) {
      const auditsBefore = await auditCount(key);
      const result = await submit({ featureKey: key, mode: "override", enabled: "true" });

      expect(
        result.kind,
        `forcing on the mandatory module "${key}" must be refused`,
      ).toBe("error");
      if (result.kind === "error") {
        expect(result.code).toBe("invalid");
        expect(result.message.toLowerCase()).toContain("mandatory");
      }
      expect(
        await readOverride(key),
        `a refused request must not store an entitlement for "${key}"`,
      ).toBeNull();
      expect(
        await auditCount(key),
        "a refused request must not record a committed entitlement",
      ).toBe(auditsBefore);
    }
  });

  it("refuses to force off every mandatory core module", async () => {
    for (const key of MANDATORY_MODULES) {
      const auditsBefore = await auditCount(key);
      const result = await submit({ featureKey: key, mode: "override", enabled: "false" });

      expect(
        result.kind,
        `forcing off the mandatory module "${key}" must be refused`,
      ).toBe("error");
      expect(await readOverride(key)).toBeNull();
      expect(await auditCount(key)).toBe(auditsBefore);
    }
  });

  it("refuses the legacy override shape on a mandatory core module", async () => {
    const key = MANDATORY_MODULES[0]!;
    const auditsBefore = await auditCount(key);

    const result = await submit({
      featureKey: key,
      mode: "override",
      enabled: "false",
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("invalid");
      expect(result.message.toLowerCase()).toContain("mandatory");
    }
    expect(await readOverride(key)).toBeNull();
    expect(await auditCount(key)).toBe(auditsBefore);
  });

  it("refuses a mandatory module whose key only differs by surrounding space", async () => {
    const key = MANDATORY_MODULES[0]!;
    const result = await submit({ featureKey: ` ${key} `, mode: "override", enabled: "true" });

    expect(result.kind).toBe("error");
    expect(await readOverride(key)).toBeNull();
  });
});

describe("F05 — a stored mandatory override is never deleted", () => {
  it("refuses a reset of a mandatory module and leaves the stored row untouched", async () => {
    const key = MANDATORY_MODULES[0]!;
    await admin.query(
      `insert into tenant_features (tenant_id, feature_key, enabled, expires_at)
       values ($1, $2, false, null)
       on conflict (tenant_id, feature_key) do update set enabled = false`,
      [TENANT_ID, key],
    );

    const result = await submit({ featureKey: key, mode: "clear" });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message.toLowerCase()).toContain("mandatory");
    }
    const row = await readOverride(key);
    expect(
      row,
      "a customer's stored override must never be auto-deleted",
    ).not.toBeNull();
    expect(row!.enabled).toBe(false);
  });

  it("refuses a force-off of a mandatory module and leaves the stored row untouched", async () => {
    const key = MANDATORY_MODULES[1]!;
    await admin.query(
      `insert into tenant_features (tenant_id, feature_key, enabled, expires_at)
       values ($1, $2, true, null)
       on conflict (tenant_id, feature_key) do update set enabled = true`,
      [TENANT_ID, key],
    );

    const result = await submit({ featureKey: key, mode: "override", enabled: "false" });

    expect(result.kind).toBe("error");
    const row = await readOverride(key);
    expect(row).not.toBeNull();
    expect(row!.enabled).toBe(true);
  });
});

describe("F05 — an ordinary optional module keeps working", () => {
  it("still forces an optional module on", async () => {
    const key = optionalKey("enable");
    await ensureFeature(key, "Optional Feature");

    const result = await submit({ featureKey: key, mode: "override", enabled: "true" });

    expect(result.kind).toBe("ok");
    expect((await readOverride(key))!.enabled).toBe(true);
  });

  it("still forces an optional module off", async () => {
    const key = optionalKey("disable");
    await ensureFeature(key, "Optional Feature");

    const result = await submit({ featureKey: key, mode: "override", enabled: "false" });

    expect(result.kind).toBe("ok");
    expect((await readOverride(key))!.enabled).toBe(false);
  });

  it("still resets an optional module to the plan", async () => {
    const key = optionalKey("clear");
    await ensureFeature(key, "Optional Feature");
    await submit({ featureKey: key, mode: "override", enabled: "true" });

    const result = await submit({ featureKey: key, mode: "clear" });

    expect(result.kind).toBe("ok");
    expect(await readOverride(key)).toBeNull();
  });

  it("still keeps a timed override timed", async () => {
    const key = optionalKey("timed");
    await ensureFeature(key, "Optional Feature");
    const expiry = "2031-03-04T05:06:07.000Z";

    const result = await submit({
      featureKey: key,
      mode: "override",
      enabled: "true",
      expiresAt: expiry,
    });

    expect(result.kind).toBe("ok");
    expect((await readOverride(key))!.expiresAt).toBe(expiry);
  });
});

describe("F05 — the role denial still comes first", () => {
  it("denies a viewer before the mandatory rule can answer", async () => {
    const key = MANDATORY_MODULES[0]!;
    actor.role = "viewer";
    try {
      const auditsBefore = await auditCount(key);
      const rowBefore = await readOverride(key);
      const result = await submit({ featureKey: key, mode: "override", enabled: "true" });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.message).toBe("Your platform account has read-only access.");
      }
      expect(
        await readOverride(key),
        "a denied request must not change the stored override",
      ).toEqual(rowBefore);
      expect(await auditCount(key)).toBe(auditsBefore);
    } finally {
      actor.role = "admin";
    }
  });

  it("denies a viewer on an optional module too", async () => {
    const key = optionalKey("viewer");
    await ensureFeature(key, "Optional Feature");
    actor.role = "viewer";
    try {
      const result = await submit({ featureKey: key, mode: "override", enabled: "true" });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.message).toBe("Your platform account has read-only access.");
      }
      expect(await readOverride(key)).toBeNull();
    } finally {
      actor.role = "admin";
    }
  });
});

describe("F05 — the strict legacy validation is unchanged", () => {
  // F03/F04 is now composed; this original strict-input assertion runs.
  it("still rejects a legacy override that does not say what it wants", async () => {
    const key = optionalKey("legacy");
    await ensureFeature(key, "Optional Feature");

    const result = await submit({ featureKey: key, mode: "override" });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("invalid");
    }
    expect(await readOverride(key)).toBeNull();
  });
});
