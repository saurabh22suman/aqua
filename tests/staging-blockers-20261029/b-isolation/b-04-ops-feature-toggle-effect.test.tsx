// @vitest-environment jsdom
//
// F03 / F04 — the Ops per-tenant entitlement editor, end to end.
//
// The submitted FormData is NOT hand-built here: the editor is
// rendered exactly as the Ops console renders it and the operator
// presses the real buttons, so the FormData that reaches the server
// action is the one the browser would send. The server action, the
// opsAction pipeline, the service, the transaction and the audit row
// are all real; only the platform session is stubbed (the session
// boundary belongs to another lane and is covered by its own suites).
//
// F03 — "Force on" used to submit no `enabled` field at all, the
// action turned the absent value into false, and the tenant was force
// OFF when the operator asked to force it ON.
//
// F04 — the editor sent no expiry, and the backend upsert is a
// complete replacement, so editing a timed override dropped its
// deadline.
//
// Fixture setup uses the privileged pool; every assertion reads the
// committed rows.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";

const { actor } = vi.hoisted(() => ({ actor: { id: "" } }));

// The action revalidates the tenant page after a successful write.
// Outside a Next request scope there is no cache to revalidate, and
// the revalidation is not what this regression is about.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The platform session is the other lane's boundary. The actor id is a
// real platform_users row so opsAction's own role/status re-read still
// applies.
vi.mock("@/lib/actions/platform-auth", () => ({
  requireOpsAdminAction: async () =>
    actor.id
      ? { kind: "ok", userId: actor.id, role: "admin" }
      : { kind: "error", reason: "unauthenticated" },
}));

import { TenantFeatureToggles } from "@/app/(platform)/ops/tenants/[tenantId]/tenant-feature-toggles";
import { resolveTenantFeatureSources } from "@/db/features";
import { asTenantId } from "@/lib/ids";

const RUN = Date.now().toString(36);
const FEATURE_KEY = `bv-toggle-feat-${RUN}`;
const TENANT_ID = uuidv7();
const TENANT_SLUG = `bv-toggle-t-${RUN}`;
const DEADLINE = new Date("2026-12-31T18:30:00.000Z");
const EXPIRED = new Date("2020-01-01T00:00:00.000Z");

type OverrideRow = { enabled: boolean; expires_at: Date | null } | null;

async function readOverride(): Promise<OverrideRow> {
  const { rows } = await admin.query<{ enabled: boolean; expires_at: Date | null }>(
    "select enabled, expires_at from tenant_features where tenant_id = $1 and feature_key = $2",
    [TENANT_ID, FEATURE_KEY],
  );
  return rows[0] ?? null;
}

async function readAudit(): Promise<
  Array<{ action: string; detail: Record<string, unknown> }>
> {
  const { rows } = await admin.query<{
    action: string;
    detail: Record<string, unknown>;
  }>(
    `select action, detail from platform_audit_log
      where tenant_id = $1 and action like 'tenant_feature.%'
      order by created_at asc, id asc`,
    [TENANT_ID],
  );
  return rows;
}

async function seedOverride(enabled: boolean, expiresAt: Date | null): Promise<void> {
  await admin.query(
    `insert into tenant_features (tenant_id, feature_key, enabled, expires_at)
     values ($1, $2, $3, $4)
     on conflict (tenant_id, feature_key)
       do update set enabled = excluded.enabled, expires_at = excluded.expires_at`,
    [TENANT_ID, FEATURE_KEY, enabled, expiresAt ? expiresAt.toISOString() : null],
  );
}

beforeAll(async () => {
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values (gen_random_uuid(), $1, 'Toggle Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do nothing`,
    [`bv-toggle-${RUN}@platform.test`],
  );
  const found = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [`bv-toggle-${RUN}@platform.test`],
  );
  actor.id = found.rows[0]!.id;
  await admin.query(
    `insert into features (key, name, category, status) values ($1, 'Toggle Feature', 'core', 'ga')`,
    [FEATURE_KEY],
  );
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'Toggle Tenant', 'trial')",
    [TENANT_ID, TENANT_SLUG],
  );
});

afterAll(async () => {
  await admin.query("delete from platform_audit_log where tenant_id = $1", [TENANT_ID]);
  await admin.query("delete from tenant_features where tenant_id = $1", [TENANT_ID]);
  await admin.query("delete from tenants where id = $1", [TENANT_ID]);
  await admin.query("delete from features where key = $1", [FEATURE_KEY]);
  await admin.query("delete from platform_users where email = $1", [
    `bv-toggle-${RUN}@platform.test`,
  ]);
  await admin.end();
});

afterEach(() => {
  cleanup();
});

function renderEditor(feature: {
  key: string;
  source: "plan" | "tenant_override" | "denied";
  expiresAt?: Date;
}): void {
  render(
    <TenantFeatureToggles
      tenantId={TENANT_ID}
      initial={[feature]}
      canWrite={true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
}

// The audit row is written in the SAME transaction as the mutation, so
// a new audit row is the reliable signal that the action committed.
// Waiting on the override row's own value is not: the seeded row can
// already hold the expected value, and the read would then race the
// still-running action.
async function pressAndWaitForCommit(label: string): Promise<void> {
  const before = (await readAudit()).length;
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(async () => {
    expect(
      (await readAudit()).length,
      "the action must commit its audit row",
    ).toBeGreaterThan(before);
  });
}

describe("F03 — Force on really forces the feature on", () => {
  it("stores enabled = true when the operator presses Force on", async () => {
    renderEditor({ key: FEATURE_KEY, source: "plan" });
    await pressAndWaitForCommit("Force on");

    const row = await readOverride();
    expect(row, "the override row must be written").not.toBeNull();
    expect(
      row!.enabled,
      "Force on must not store the disable path",
    ).toBe(true);

    const audit = await readAudit();
    const last = audit[audit.length - 1]!;
    expect(last.action).toBe("tenant_feature.upsert");
    expect(
      last.detail.enabled,
      "the audit trail must record the boolean the operator asked for",
    ).toBe(true);
  });

  it("stores enabled = false when the operator presses Force off", async () => {
    await seedOverride(true, null);
    renderEditor({ key: FEATURE_KEY, source: "tenant_override" });
    await pressAndWaitForCommit("Force off");

    const row = await readOverride();
    expect(row!.enabled).toBe(false);
  });

  it("removes the override row when the operator presses Reset to plan", async () => {
    await seedOverride(true, null);
    renderEditor({ key: FEATURE_KEY, source: "tenant_override" });
    await pressAndWaitForCommit("Reset to plan");

    expect(await readOverride(), "Reset to plan must delete the override").toBeNull();
    const audit = await readAudit();
    expect(audit.some((row) => row.action === "tenant_feature.clear")).toBe(true);
  });
});

describe("F04 — editing an entitlement keeps its deadline", () => {
  it("keeps the deadline of a timed grant when it is turned off", async () => {
    await seedOverride(true, DEADLINE);
    renderEditor({
      key: FEATURE_KEY,
      source: "tenant_override",
      expiresAt: DEADLINE,
    });
    await pressAndWaitForCommit("Force off");

    const row = await readOverride();
    expect(row!.enabled).toBe(false);
    expect(
      row!.expires_at,
      "editing a timed override must not drop its deadline",
    ).not.toBeNull();
    expect(new Date(row!.expires_at!).getTime()).toBe(DEADLINE.getTime());
  });

  it("keeps the deadline of a timed denial when it is turned on", async () => {
    await seedOverride(false, DEADLINE);
    renderEditor({
      key: FEATURE_KEY,
      source: "denied",
      expiresAt: DEADLINE,
    });
    await pressAndWaitForCommit("Force on");

    const row = await readOverride();
    expect(row!.enabled).toBe(true);
    expect(
      row!.expires_at,
      "editing a timed denial must not drop its deadline",
    ).not.toBeNull();
    expect(new Date(row!.expires_at!).getTime()).toBe(DEADLINE.getTime());
  });

  it("records the deadline it kept in the audit trail", async () => {
    await seedOverride(true, DEADLINE);
    renderEditor({
      key: FEATURE_KEY,
      source: "tenant_override",
      expiresAt: DEADLINE,
    });
    await pressAndWaitForCommit("Force off");

    const audit = await readAudit();
    const last = audit[audit.length - 1]!;
    expect(last.action).toBe("tenant_feature.upsert");
    expect(
      last.detail.expiresAt,
      "the audit trail must show the deadline that is still in force",
    ).toBe(DEADLINE.toISOString());
  });
});

describe("the expiry fallback still holds (affected check)", () => {
  it("ignores an override whose deadline has passed", async () => {
    await seedOverride(true, EXPIRED);
    const resolved = await resolveTenantFeatureSources(asTenantId(TENANT_ID));
    expect(
      resolved.map((f) => f.key),
      "an expired override must fall through to the plan",
    ).not.toContain(FEATURE_KEY);
  });

  it("reports an override whose deadline is still in the future", async () => {
    await seedOverride(true, DEADLINE);
    const resolved = await resolveTenantFeatureSources(asTenantId(TENANT_ID));
    expect(resolved.map((f) => f.key)).toContain(FEATURE_KEY);
  });
});
