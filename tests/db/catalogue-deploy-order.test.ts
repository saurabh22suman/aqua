// tests/db/catalogue-deploy-order.test.ts
//
// Third occurrence of the catalogue seeding pattern (#125 deploy-
// order, then staff-records / coach-me-page / invite-link-reset-
// purpose suite failures). The previous fixes added a seed script
// (db/seed-platform.ts) and a pretest hook (pnpm test → tsx
// db/seed-platform.ts). Neither covers the real production entry
// point: `pnpm db:deploy` runs migrations + pg-boss bootstrap, no
// seed. A fresh production database after `db:deploy` therefore
// had empty `permissions`, `features`, etc. — the first call to
// requirePermission("settings.manage") in lib/actions/branding.ts
// hit the role_permissions.permission_key FK and crashed.
//
// Migration 20260918000000_reference_catalogue.sql embeds the
// reference catalogue directly. This test pins the deploy-order
// guarantee: with migrations ONLY (no seed script), every
// permission key used by code exists in the catalogue and the
// real requirePermission path resolves cleanly.
//
// Testcontainer-only. RED on a worktree that doesn't have the
// catalogue migration applied; GREEN once the migration lands.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { IsolatedDb } from "../helpers/isolated-db";
import { startIsolatedDb } from "../helpers/isolated-db";

let isolated: IsolatedDb;
let admin: IsolatedDb["admin"];

let seedRoleTemplates: typeof import("@/lib/services/roles").seedRoleTemplates;
let resolvePermissionContext: typeof import("@/lib/auth/permission").resolvePermissionContext;
let appPool: typeof import("@/db/client").pool;

beforeAll(async () => {
  isolated = await startIsolatedDb();
  // Set the env BEFORE the dynamic imports so @/db/client opens its
  // pool against the Testcontainer (not the .env shared dev DB).
  process.env.DATABASE_URL = isolated.appUri;
  process.env.MIGRATION_DATABASE_URL = isolated.adminUri;
  process.env.APP_LOGIN_PASSWORD = decodeURIComponent(
    new URL(isolated.appUri).password,
  );
  vi.resetModules();
  ({ seedRoleTemplates } = await import("@/lib/services/roles"));
  ({ resolvePermissionContext } = await import("@/lib/auth/permission"));
  appPool = (await import("@/db/client")).pool;
  admin = isolated.admin;
}, 120_000);

afterAll(async () => {
  await appPool?.end();
  await isolated?.stop();
});

describe("deploy order: catalogue is correct after migrations only (no seed)", () => {
  it("the catalogue tables that code depends on are populated by the migration alone", async () => {
    // Confirm every catalogue table the code reads is populated by
    // the migration alone — no seedPlatformCatalogue() call. This is
    // the deploy-order guarantee that broke in #125 and the staff-
    // records jest earlier: an operator who runs `pnpm db:deploy`
    // without `pnpm db:seed` used to land with empty catalogue tables.
    const expectCounts: Array<[string, number]> = [
      ["permissions", 32],
      ["features", 16],
      ["plans", 1],
      ["presets", 7],
      ["config_keys", 5],
      ["policy_versions", 1],
    ];
    for (const [t, want] of expectCounts) {
      const r = await admin.query<{ n: number }>(`select count(*)::int as n from ${t}`);
      const got = Number(r.rows[0]!.n);
      expect(got, `${t} populated by migration`).toBeGreaterThanOrEqual(want);
    }
  });

  it("settings.manage permission key exists end-to-end after migrations only", async () => {
    // The exact requirePermission("settings.manage") callsite is in
    // lib/actions/branding.ts:60 — the path a real owner hits when
    // they want to change the academy's name. With migrations only
    // (no seed), the catalogue must already have this key.
    const r = await admin.query<{ key: string; module: string }>(
      `select key, module from permissions where key = $1`,
      ["settings.manage"],
    );
    expect(r.rows, "settings.manage must exist after migrations only").toHaveLength(1);
    expect(r.rows[0]!.module).toBe("settings");
  });

  it("settings.manage round-trips through seedRoleTemplates + resolvePermissionContext (the real branding action path)", async () => {
    // End-to-end: create a tenant, run seedRoleTemplates (the same
    // call demo:reset / seed.ts makes), and then ask
    // resolvePermissionContext whether the owner role grants
    // settings.manage. This is the path that crashed in the staff-
    // records / coach-me-page / invite-link-reset-purpose suite
    // failures — the role_permissions FK violation.
    const tenantId = uuidv7();
    await admin.query(
      `insert into tenants (id, slug, name, status, timezone, currency, created_at)
       values ($1, $2, $3, 'active', 'Asia/Kolkata', 'INR', now())`,
      [tenantId, `deploy-order-${Date.now()}`, "Deploy Order Test"],
    );

    // The same call demo:reset / seed.ts makes. Before migration
    // 20260918000000_reference_catalogue.sql this throws with
    // "violates foreign key constraint role_permissions_permission_key_fkey"
    // when it tries to insert role_permissions for settings.manage
    // (and the other keys) because the permissions table is empty.
    await seedRoleTemplates(tenantId as never);

    // Resolve the owner role's permissions and features. The owner's
    // permission list is ALL_PERMISSION_KEYS (lib/services/roles.ts),
    // which includes settings.manage. With the migration in place,
    // every one of those keys has a matching row in `permissions`.
    const ownerRow = (
      await admin.query<{ id: string }>(
        `select id from roles where key = $1 and tenant_id = $2 limit 1`,
        ["owner", tenantId],
      )
    ).rows[0];
    expect(ownerRow, "seedRoleTemplates must have created the owner role").toBeDefined();

    const { permissions: granted, features } = await resolvePermissionContext(
      tenantId as never,
      ownerRow!.id as never,
    );
    expect(
      granted.has("settings.manage"),
      "owner must have settings.manage granted after seedRoleTemplates + resolvePermissionContext",
    ).toBe(true);
    expect(
      features.has("settings"),
      "settings module must be feature-enabled after seedRoleTemplates",
    ).toBe(true);

    // And the role_permissions rows are real DB rows (not just in-
    // memory), so the second requirePermission(ctx, ...) call inside
    // a real request would read them again and find settings.manage.
    const rp = await admin.query<{ key: string }>(
      `select permission_key as key from role_permissions where role_id = $1`,
      [ownerRow!.id],
    );
    const rpKeys = new Set(rp.rows.map((r) => r.key));
    expect(rpKeys.has("settings.manage")).toBe(true);
  });
});
