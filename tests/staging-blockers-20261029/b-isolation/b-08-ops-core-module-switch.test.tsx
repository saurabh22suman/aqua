// @vitest-environment jsdom
//
// F05 (human decision, 29 October 2026) — the six core modules are
// MANDATORY: "Keep core modules mandatory and remove misleading switches".
//
// The runtime policy (lib/auth/permission.ts, a protected path that
// this lane does not edit) treats members / attendance / programs /
// enquiries / staff / settings as always-on: a tenant always has them,
// whatever its plan or any override says. The Ops entitlement editor
// did not know that, so it offered a switch for every feature —
// including a core module, where "Force off" stores a row the runtime
// ignores. The operator saw a working control that does nothing.
//
// The contract this file pins:
//
//   1. no switch is offered for a module the runtime always keeps on;
//   2. a switch IS still offered for an optional module;
//   3. a core module is SHOWN as included even when a historical denial
//      row exists — the stored row is never silently deleted;
//   4. the set of features without a switch is exactly the runtime's
//      always-on set — no more, no less.
//
// The runtime set is not hard-coded here: it is derived from
// requirePermission itself, so this test fails if the two ever drift.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { PERMISSIONS } from "@/db/seed-platform";
import { requirePermission } from "@/lib/auth/permission";
import type { Ctx } from "@/lib/auth/context";
import { TenantFeatureToggles } from "@/app/(platform)/ops/tenants/[tenantId]/tenant-feature-toggles";

const TENANT_ID = uuidv7();
const TENANT_SLUG = `bv-core-${TENANT_ID}`;

function ctxWith(permissionKey: string): Ctx {
  return {
    userId: "00000000-0000-4000-8000-000000000001" as Ctx["userId"],
    tenantId: TENANT_ID as Ctx["tenantId"],
    membershipId: "membership",
    roleKey: "owner",
    roleId: "role",
    slug: "core-fixture",
    allLocations: true,
    locationIds: [],
    permissions: new Set([permissionKey]),
    // No feature is entitled: only the always-on modules may still pass.
    features: new Set<string>(),
  };
}

/** The modules the runtime keeps on for every tenant. */
function runtimeAlwaysOnModules(): Set<string> {
  const firstPermissionOf = new Map<string, string>();
  for (const permission of PERMISSIONS) {
    if (!firstPermissionOf.has(permission.module)) {
      firstPermissionOf.set(permission.module, permission.key);
    }
  }
  const alwaysOn = new Set<string>();
  for (const [module, permissionKey] of firstPermissionOf) {
    let skipped = false;
    try {
      requirePermission(ctxWith(permissionKey), permissionKey);
      skipped = true;
    } catch {
      skipped = false;
    }
    if (skipped) alwaysOn.add(module);
  }
  return alwaysOn;
}

const ALWAYS_ON = runtimeAlwaysOnModules();
const MODULES = [...new Set(PERMISSIONS.map((p) => p.module))].sort();
const OPTIONAL = MODULES.filter((m) => !ALWAYS_ON.has(m));

function renderEditor(keys: string[], source: "plan" | "denied" = "plan"): HTMLElement[] {
  render(
    <TenantFeatureToggles
      tenantId={TENANT_ID}
      initial={keys.map((key) => ({ key, source }))}
      canWrite={true}
    />,
  );
  return screen.getAllByRole("listitem");
}

function rowsWithoutSwitch(items: HTMLElement[]): string[] {
  return items
    .filter((item) => within(item).queryByRole("button", { name: "Edit" }) === null)
    .map((item) => item.querySelector("p")?.textContent ?? "");
}

beforeAll(async () => {
  await admin.query(
    "insert into tenants(id,slug,name,status) values($1,$2,'Core fixture','active')",
    [TENANT_ID, TENANT_SLUG],
  );
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await admin.query("delete from tenant_features where tenant_id=$1::uuid", [TENANT_ID]);
  await admin.query("delete from tenants where id=$1::uuid", [TENANT_ID]);
  await admin.end();
});

describe("the runtime always-on set is discovered, not assumed", () => {
  it("covers exactly six modules", () => {
    // A guard on the guard: if the runtime set ever changes size, this
    // test must be read again rather than silently passing.
    expect(ALWAYS_ON.size).toBe(6);
  });
});

describe("F05 — a mandatory core module has no switch", () => {
  it("offers no edit control for a core module", () => {
    const items = renderEditor([...ALWAYS_ON]);
    for (const item of items) {
      expect(
        within(item).queryByRole("button", { name: "Edit" }),
        "a core module must not offer a switch the runtime ignores",
      ).toBeNull();
    }
  });

  it("still offers the switch for an optional module", () => {
    const items = renderEditor([...OPTIONAL]);
    for (const item of items) {
      expect(
        within(item).queryByRole("button", { name: "Edit" }),
        "an optional module must stay operable",
      ).not.toBeNull();
    }
  });

  it("offers a switch for exactly the modules the runtime does not keep on", () => {
    const keys = [...MODULES].sort();
    const items = renderEditor(keys);
    expect(new Set(rowsWithoutSwitch(items))).toEqual(ALWAYS_ON);
  });
});

describe("F05 — a core module reads as included", () => {
  it("shows a core module as included, not denied, when a denial row exists", () => {
    const key = [...ALWAYS_ON][0]!;
    const items = renderEditor([key], "denied");
    const text = items[0]!.textContent ?? "";
    expect(text).toContain("Mandatory");
    expect(text).not.toContain("Denied");
  });

  it("does not delete the stored override", async () => {
    const key = [...ALWAYS_ON][0]!;
    await admin.query(
      `insert into tenant_features (tenant_id, feature_key, enabled, expires_at)
       values ($1, $2, false, null)
       on conflict (tenant_id, feature_key) do nothing`,
      [TENANT_ID, key],
    );

    renderEditor([key], "denied");

    const { rows } = await admin.query<{ enabled: boolean }>(
      "select enabled from tenant_features where tenant_id=$1::uuid and feature_key=$2",
      [TENANT_ID, key],
    );
    expect(
      rows,
      "a stored customer override must never be auto-deleted",
    ).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(false);
  });
});
